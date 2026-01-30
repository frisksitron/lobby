package sfu

import (
	"fmt"
	"lobby/internal/constants"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/rtcp"
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
	localTracks  map[string]*webrtc.TrackLocalStaticRTP // trackKind -> track (e.g., "audio", "video")
	outputTracks map[string]*webrtc.RTPSender           // sourceUserID:trackKind -> sender
	videoReceiver *webrtc.RTPReceiver                   // For PLI requests
	videoSSRC    uint32                                 // Video track SSRC
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
		localTracks:  make(map[string]*webrtc.TrackLocalStaticRTP),
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
		trackKind := remoteTrack.Kind().String()
		log.Printf("[SFU] [DEBUG] Peer %s OnTrack fired: kind=%s, id=%s, streamID=%s, ssrc=%d",
			id, trackKind, remoteTrack.ID(), remoteTrack.StreamID(), remoteTrack.SSRC())
		log.Printf("[SFU] [DEBUG] Peer %s OnTrack codec: mimeType=%s, clockRate=%d, channels=%d",
			id, remoteTrack.Codec().MimeType, remoteTrack.Codec().ClockRate, remoteTrack.Codec().Channels)

		localTrack, err := webrtc.NewTrackLocalStaticRTP(
			remoteTrack.Codec().RTPCodecCapability,
			trackKind,
			id,
		)
		if err != nil {
			log.Printf("[SFU] [DEBUG] Failed to create local track for %s: %v", id, err)
			return
		}
		log.Printf("[SFU] [DEBUG] Peer %s created local track for %s", id, trackKind)

		peer.mu.Lock()
		peer.localTracks[trackKind] = localTrack
		if remoteTrack.Kind() == webrtc.RTPCodecTypeVideo {
			peer.videoReceiver = receiver
			peer.videoSSRC = uint32(remoteTrack.SSRC())
			log.Printf("[SFU] [DEBUG] Peer %s stored video receiver and SSRC=%d", id, peer.videoSSRC)
		}
		peer.mu.Unlock()

		log.Printf("[SFU] [DEBUG] Peer %s calling OnPeerTrackReady for %s", id, trackKind)
		sfu.OnPeerTrackReady(id, trackKind, localTrack)
		peer.wg.Add(1)
		go peer.forwardTrack(remoteTrack, localTrack, trackKind)
	})

	return peer, nil
}

func (p *Peer) forwardTrack(remote *webrtc.TrackRemote, local *webrtc.TrackLocalStaticRTP, kind string) {
	defer p.wg.Done()

	buf := make([]byte, constants.RTPPacketBufferBytes)
	packetCount := 0
	totalBytes := 0
	lastLogTime := time.Now()

	for {
		n, _, err := remote.Read(buf)
		if err != nil {
			log.Printf("[SFU] Peer %s %s track read ended: %v (forwarded %d packets, %d bytes)", p.ID, kind, err, packetCount, totalBytes)
			return
		}
		if _, err := local.Write(buf[:n]); err != nil {
			log.Printf("[SFU] Peer %s %s track write error: %v", p.ID, kind, err)
			return
		}
		packetCount++
		totalBytes += n

		// Log periodically for video to confirm packets are flowing
		if kind == "video" && time.Since(lastLogTime) > 5*time.Second {
			log.Printf("[SFU] [DEBUG] Peer %s video: forwarded %d packets, %d bytes total", p.ID, packetCount, totalBytes)
			lastLogTime = time.Now()
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

// CreateInitialOffer creates the first offer for a new peer connection.
// It adds transceivers for audio (sendrecv) and video (recvonly) so the
// server can receive client audio and send video to the client.
func (p *Peer) CreateInitialOffer() (webrtc.SessionDescription, error) {
	if p.IsClosed() {
		return webrtc.SessionDescription{}, ErrPeerNotActive
	}

	// Add audio transceiver (sendrecv) - server receives client audio and sends other users' audio
	_, err := p.conn.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionSendrecv,
	})
	if err != nil {
		return webrtc.SessionDescription{}, fmt.Errorf("failed to add audio transceiver: %w", err)
	}

	// Add video transceiver (sendrecv) - for screen sharing
	_, err = p.conn.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionSendrecv,
	})
	if err != nil {
		return webrtc.SessionDescription{}, fmt.Errorf("failed to add video transceiver: %w", err)
	}

	return p.conn.CreateOffer(nil)
}

func (p *Peer) AddICECandidate(candidate webrtc.ICECandidateInit) error {
	if p.IsClosed() {
		return ErrPeerNotActive
	}
	return p.conn.AddICECandidate(candidate)
}

func (p *Peer) AddTrack(sourceUserID string, trackKind string, track *webrtc.TrackLocalStaticRTP) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.IsClosed() {
		return nil
	}

	key := sourceUserID + ":" + trackKind
	if _, exists := p.outputTracks[key]; exists {
		return nil
	}

	sender, err := p.conn.AddTrack(track)
	if err != nil {
		return err
	}

	p.outputTracks[key] = sender

	// Drain RTCP packets to prevent buffer overflow
	p.wg.Add(1)
	go p.drainRTCP(sender)

	log.Printf("[SFU] Added %s track from %s to peer %s", trackKind, sourceUserID, p.ID)
	return nil
}

func (p *Peer) RemoveTrack(sourceUserID string, trackKind string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.IsClosed() {
		return nil
	}

	key := sourceUserID + ":" + trackKind
	sender, exists := p.outputTracks[key]
	if !exists {
		return nil
	}

	if err := p.conn.RemoveTrack(sender); err != nil {
		return err
	}

	delete(p.outputTracks, key)
	log.Printf("[SFU] Removed %s track from %s from peer %s", trackKind, sourceUserID, p.ID)
	return nil
}

// RemoveAllTracksFrom removes all tracks from a specific source user
func (p *Peer) RemoveAllTracksFrom(sourceUserID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.IsClosed() {
		return nil
	}

	prefix := sourceUserID + ":"
	var keysToRemove []string
	for key := range p.outputTracks {
		if len(key) > len(prefix) && key[:len(prefix)] == prefix {
			keysToRemove = append(keysToRemove, key)
		}
	}

	for _, key := range keysToRemove {
		sender := p.outputTracks[key]
		if err := p.conn.RemoveTrack(sender); err != nil {
			log.Printf("[SFU] Error removing track %s: %v", key, err)
			continue
		}
		delete(p.outputTracks, key)
		log.Printf("[SFU] Removed track %s from peer %s", key, p.ID)
	}

	return nil
}

func (p *Peer) GetLocalTrack(trackKind string) *webrtc.TrackLocalStaticRTP {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.localTracks[trackKind]
}

// RequestKeyframe sends a PLI (Picture Loss Indication) to request a keyframe
func (p *Peer) RequestKeyframe() error {
	p.mu.RLock()
	receiver := p.videoReceiver
	ssrc := p.videoSSRC
	p.mu.RUnlock()

	if receiver == nil {
		return nil
	}

	// Send PLI (Picture Loss Indication) to request a keyframe
	return p.conn.WriteRTCP([]rtcp.Packet{
		&rtcp.PictureLossIndication{MediaSSRC: ssrc},
	})
}

func (p *Peer) NeedsRenegotiation() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.conn.SignalingState() == webrtc.SignalingStateStable
}

func (p *Peer) SignalingState() webrtc.SignalingState {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.conn.SignalingState()
}

// Rollback rolls back a pending local offer to return to stable state
func (p *Peer) Rollback() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.IsClosed() {
		return ErrPeerNotActive
	}
	return p.conn.SetLocalDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeRollback})
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
