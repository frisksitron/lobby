package sfu

import (
	"lobby/internal/constants"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/webrtc/v4"
)

type PeerState int32

const (
	PeerStateConnecting PeerState = iota
	PeerStateActive
	PeerStateClosing
	PeerStateClosed
)

const (
	peerCloseTimeout = 3 * time.Second
)

type Peer struct {
	ID           string
	conn         *webrtc.PeerConnection
	sfu          *SFU
	mu           sync.RWMutex
	state        atomic.Int32
	wg           sync.WaitGroup
	localTrack   *webrtc.TrackLocalStaticRTP
	outputTracks map[string]*webrtc.RTPSender
}

func NewPeer(id string, sfu *SFU) (*Peer, error) {
	config := sfu.config.ToWebRTCConfig()
	conn, err := sfu.api.NewPeerConnection(config)
	if err != nil {
		return nil, err
	}

	peer := &Peer{
		ID:           id,
		conn:         conn,
		sfu:          sfu,
		outputTracks: make(map[string]*webrtc.RTPSender),
	}
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

func (p *Peer) forwardTrack(remote *webrtc.TrackRemote, local *webrtc.TrackLocalStaticRTP) {
	defer p.wg.Done()

	buf := make([]byte, constants.RTPPacketBufferBytes)
	for {
		n, _, err := remote.Read(buf)
		if err != nil {
			return
		}
		if _, err := local.Write(buf[:n]); err != nil {
			return
		}
	}
}

// drainRTCP reads and discards RTCP packets from an RTP sender.
// This prevents the RTCP receive buffer from filling up.
func (p *Peer) drainRTCP(sender *webrtc.RTPSender) {
	defer p.wg.Done()

	buf := make([]byte, constants.RTPPacketBufferBytes)
	for {
		if _, _, err := sender.Read(buf); err != nil {
			return
		}
	}
}

func (p *Peer) SetRemoteDescription(sdp webrtc.SessionDescription) error {
	if p.IsClosed() {
		return ErrPeerNotActive
	}
	return p.conn.SetRemoteDescription(sdp)
}

func (p *Peer) CreateAnswer() (webrtc.SessionDescription, error) {
	if p.IsClosed() {
		return webrtc.SessionDescription{}, ErrPeerNotActive
	}
	return p.conn.CreateAnswer(nil)
}

func (p *Peer) SetLocalDescription(sdp webrtc.SessionDescription) error {
	if p.IsClosed() {
		return ErrPeerNotActive
	}
	return p.conn.SetLocalDescription(sdp)
}

func (p *Peer) CreateOffer() (webrtc.SessionDescription, error) {
	if p.IsClosed() {
		return webrtc.SessionDescription{}, ErrPeerNotActive
	}
	return p.conn.CreateOffer(nil)
}

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
		return nil
	}

	if _, exists := p.outputTracks[sourceUserID]; exists {
		return nil
	}

	sender, err := p.conn.AddTrack(track)
	if err != nil {
		return err
	}

	p.outputTracks[sourceUserID] = sender

	// Drain RTCP packets to prevent buffer overflow
	p.wg.Add(1)
	go p.drainRTCP(sender)

	log.Printf("[SFU] Added track from %s to peer %s", sourceUserID, p.ID)
	return nil
}

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

func (p *Peer) GetLocalTrack() *webrtc.TrackLocalStaticRTP {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.localTrack
}

func (p *Peer) NeedsRenegotiation() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.conn.SignalingState() == webrtc.SignalingStateStable
}

func (p *Peer) Close() error {
	if !p.transitionTo(PeerStateClosing) {
		return nil
	}

	log.Printf("[SFU] Closing peer %s", p.ID)

	// Close the peer connection - this will unblock any blocking reads
	err := p.conn.Close()

	done := make(chan struct{})
	go func() {
		p.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(peerCloseTimeout):
		log.Printf("[SFU] Warning: peer %s goroutines did not finish within timeout", p.ID)
	}

	p.transitionTo(PeerStateClosed)
	return err
}

func (p *Peer) State() PeerState {
	return PeerState(p.state.Load())
}

func (p *Peer) IsActive() bool {
	return p.State() == PeerStateActive
}

func (p *Peer) IsClosed() bool {
	state := p.State()
	return state == PeerStateClosing || state == PeerStateClosed
}

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
