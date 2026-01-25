package sfu

import (
	"context"
	"io"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/webrtc/v4"

	"lobby/internal/constants"
)

// PeerState represents the lifecycle state of a peer connection
type PeerState int32

const (
	// PeerStateConnecting indicates the peer is setting up
	PeerStateConnecting PeerState = iota
	// PeerStateActive indicates the peer is ready for operations
	PeerStateActive
	// PeerStateClosing indicates shutdown has been initiated
	PeerStateClosing
	// PeerStateClosed indicates terminal state
	PeerStateClosed
)

const (
	// peerCloseTimeout is how long to wait for goroutines to stop during Close()
	peerCloseTimeout = 3 * time.Second
)

// Peer represents a single user's WebRTC connection to the SFU
type Peer struct {
	ID       string // User ID
	conn     *webrtc.PeerConnection
	sfu      *SFU
	mu       sync.RWMutex
	state    atomic.Int32 // Lifecycle state (PeerState)
	speaking bool
	ctx      context.Context    // Context for goroutine cancellation
	cancel   context.CancelFunc // Cancel function to signal shutdown
	wg       sync.WaitGroup     // WaitGroup to track running goroutines

	// Local track from this peer (their microphone)
	localTrack *webrtc.TrackLocalStaticRTP

	// Tracks sent to this peer (other users' audio)
	// Key is the source user ID
	outputTracks map[string]*webrtc.RTPSender
}

func NewPeer(id string, sfu *SFU) (*Peer, error) {
	config := sfu.config.ToWebRTCConfig()
	conn, err := sfu.api.NewPeerConnection(config)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	peer := &Peer{
		ID:           id,
		conn:         conn,
		sfu:          sfu,
		ctx:          ctx,
		cancel:       cancel,
		outputTracks: make(map[string]*webrtc.RTPSender),
	}
	// Initialize state to Connecting
	peer.state.Store(int32(PeerStateConnecting))

	conn.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		sfu.OnIceCandidate(id, candidate)
	})

	conn.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("[SFU] Peer %s connection state: %s", id, state.String())
		switch state {
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			peer.Close()
		case webrtc.PeerConnectionStateConnected:
			if peer.transitionTo(PeerStateActive) {
				log.Printf("[SFU] Peer %s fully connected and active", id)
			}
		}
	})

	conn.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		log.Printf("[SFU] Peer %s sent track: %s (kind: %s)", id, remoteTrack.ID(), remoteTrack.Kind())

		if remoteTrack.Kind() != webrtc.RTPCodecTypeAudio {
			return
		}

		localTrack, err := webrtc.NewTrackLocalStaticRTP(
			remoteTrack.Codec().RTPCodecCapability,
			"audio",
			id,
		)
		if err != nil {
			log.Printf("[SFU] Failed to create local track for %s: %v", id, err)
			return
		}

		peer.mu.Lock()
		peer.localTrack = localTrack
		peer.mu.Unlock()

		sfu.OnPeerTrackReady(id, localTrack)
		peer.wg.Add(1)
		go peer.forwardTrack(remoteTrack, localTrack)
	})

	return peer, nil
}

// forwardTrack reads RTP packets from remote and writes to local track
func (p *Peer) forwardTrack(remote *webrtc.TrackRemote, local *webrtc.TrackLocalStaticRTP) {
	defer p.wg.Done()

	buf := make([]byte, constants.RTPPacketBufferBytes)
	for {
		// Check context cancellation before blocking read
		select {
		case <-p.ctx.Done():
			return
		default:
		}

		n, _, err := remote.Read(buf)
		if err != nil {
			// Check if we're shutting down - context cancelled or EOF
			if p.ctx.Err() != nil || err == io.EOF {
				return
			}
			log.Printf("[SFU] Error reading from remote track %s: %v", p.ID, err)
			return
		}

		if _, err := local.Write(buf[:n]); err != nil {
			if p.ctx.Err() != nil {
				return
			}
			log.Printf("[SFU] Error writing to local track %s: %v", p.ID, err)
			return
		}
	}
}

// SetRemoteDescription sets the remote SDP (offer from client)
func (p *Peer) SetRemoteDescription(sdp webrtc.SessionDescription) error {
	if p.IsClosed() {
		return ErrPeerNotActive
	}
	return p.conn.SetRemoteDescription(sdp)
}

// CreateAnswer creates an SDP answer after receiving an offer
func (p *Peer) CreateAnswer() (webrtc.SessionDescription, error) {
	if p.IsClosed() {
		return webrtc.SessionDescription{}, ErrPeerNotActive
	}
	return p.conn.CreateAnswer(nil)
}

// SetLocalDescription sets the local SDP (answer to send to client)
func (p *Peer) SetLocalDescription(sdp webrtc.SessionDescription) error {
	if p.IsClosed() {
		return ErrPeerNotActive
	}
	return p.conn.SetLocalDescription(sdp)
}

// CreateOffer creates an SDP offer for renegotiation
func (p *Peer) CreateOffer() (webrtc.SessionDescription, error) {
	if p.IsClosed() {
		return webrtc.SessionDescription{}, ErrPeerNotActive
	}
	return p.conn.CreateOffer(nil)
}

// AddICECandidate adds a remote ICE candidate
func (p *Peer) AddICECandidate(candidate webrtc.ICECandidateInit) error {
	if p.IsClosed() {
		return ErrPeerNotActive
	}
	return p.conn.AddICECandidate(candidate)
}

func (p *Peer) AddTrack(sourceUserID string, track *webrtc.TrackLocalStaticRTP) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.IsClosed() {
		return nil // Silently ignore for closing peers
	}

	if _, exists := p.outputTracks[sourceUserID]; exists {
		return nil
	}

	sender, err := p.conn.AddTrack(track)
	if err != nil {
		return err
	}

	p.outputTracks[sourceUserID] = sender

	// Read RTCP packets (required for WebRTC to function properly)
	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		rtcpBuf := make([]byte, constants.RTPPacketBufferBytes)
		for {
			select {
			case <-p.ctx.Done():
				return
			default:
			}

			if _, _, err := sender.Read(rtcpBuf); err != nil {
				// Exit on any error - context cancelled or connection closed
				return
			}
		}
	}()

	log.Printf("[SFU] Added track from %s to peer %s", sourceUserID, p.ID)
	return nil
}

// RemoveTrack removes a track from another peer
func (p *Peer) RemoveTrack(sourceUserID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.IsClosed() {
		return nil
	}

	sender, exists := p.outputTracks[sourceUserID]
	if !exists {
		return nil
	}

	if err := p.conn.RemoveTrack(sender); err != nil {
		return err
	}

	delete(p.outputTracks, sourceUserID)
	log.Printf("[SFU] Removed track from %s from peer %s", sourceUserID, p.ID)
	return nil
}

// GetLocalTrack returns this peer's local audio track
func (p *Peer) GetLocalTrack() *webrtc.TrackLocalStaticRTP {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.localTrack
}

// NeedsRenegotiation checks if peer needs SDP renegotiation
func (p *Peer) NeedsRenegotiation() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.conn.SignalingState() == webrtc.SignalingStateStable
}

func (p *Peer) Close() error {
	if !p.transitionTo(PeerStateClosing) {
		return nil // Already closing/closed
	}

	log.Printf("[SFU] Closing peer %s", p.ID)

	// Cancel context to signal goroutines to stop
	p.cancel()

	// Close the peer connection - this will unblock any blocking reads
	err := p.conn.Close()

	// Wait for goroutines to finish with timeout
	done := make(chan struct{})
	go func() {
		p.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		// All goroutines finished
	case <-time.After(peerCloseTimeout):
		log.Printf("[SFU] Warning: peer %s goroutines did not finish within timeout", p.ID)
	}

	p.transitionTo(PeerStateClosed)
	p.sfu.OnPeerClosed(p.ID)
	return err
}

// State returns the current peer state
func (p *Peer) State() PeerState {
	return PeerState(p.state.Load())
}

// IsActive returns whether the peer is in the active state
func (p *Peer) IsActive() bool {
	return p.State() == PeerStateActive
}

// IsClosed returns whether the peer is closing or closed (backward compatible)
func (p *Peer) IsClosed() bool {
	state := p.State()
	return state == PeerStateClosing || state == PeerStateClosed
}

// isValidTransition checks if a state transition is allowed
func isValidTransition(from, to PeerState) bool {
	switch from {
	case PeerStateConnecting:
		// Connecting can go to Active or Closing
		return to == PeerStateActive || to == PeerStateClosing
	case PeerStateActive:
		// Active can only go to Closing
		return to == PeerStateClosing
	case PeerStateClosing:
		// Closing can only go to Closed
		return to == PeerStateClosed
	case PeerStateClosed:
		// Terminal state - no transitions allowed
		return false
	}
	return false
}

// transitionTo atomically transitions to a new state if the transition is valid
func (p *Peer) transitionTo(newState PeerState) bool {
	for {
		current := PeerState(p.state.Load())
		if !isValidTransition(current, newState) {
			return false
		}
		if p.state.CompareAndSwap(int32(current), int32(newState)) {
			return true
		}
	}
}

// SetSpeaking updates the speaking state
func (p *Peer) SetSpeaking(speaking bool) {
	p.mu.Lock()
	p.speaking = speaking
	p.mu.Unlock()
}

// IsSpeaking returns the speaking state
func (p *Peer) IsSpeaking() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.speaking
}
