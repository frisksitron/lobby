package sfu

import (
	"fmt"
	"log"
	"strings"
	"sync"

	"github.com/pion/webrtc/v4"
)

type SignalingCallback func(userID string, eventType string, payload interface{})

type RtcOfferPayload struct {
	SDP string `json:"sdp"`
}

type RtcIceCandidatePayload struct {
	Candidate     string  `json:"candidate"`
	SDPMid        *string `json:"sdpMid,omitempty"`
	SDPMLineIndex *uint16 `json:"sdpMLineIndex,omitempty"`
}

type VideoTrackCallback func(userID string, track *webrtc.TrackLocalStaticRTP)

// SFU manages WebRTC peer connections for voice chat
type SFU struct {
	config                *Config
	api                   *webrtc.API
	mu                    sync.RWMutex
	peers                 map[string]*Peer
	signalingCallback     SignalingCallback
	onVideoTrackCallback  VideoTrackCallback
	screenShareManager    *ScreenShareManager
	pendingRenegotiations map[string]bool // userID -> needs renegotiation
}

func New(config *Config) (*SFU, error) {
	settingEngine := webrtc.SettingEngine{}

	if config.MinPort > 0 && config.MaxPort > 0 {
		if err := settingEngine.SetEphemeralUDPPortRange(config.MinPort, config.MaxPort); err != nil {
			return nil, fmt.Errorf("failed to set port range: %w", err)
		}
	}

	if config.PublicIP != "" {
		settingEngine.SetNAT1To1IPs([]string{config.PublicIP}, webrtc.ICECandidateTypeHost)
	}

	mediaEngine := &webrtc.MediaEngine{}
	// Register Opus with low-latency parameters for audio
	if err := mediaEngine.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:    webrtc.MimeTypeOpus,
			ClockRate:   48000,
			Channels:    2,
			SDPFmtpLine: "minptime=10;useinbandfec=1",
		},
		PayloadType: 111,
	}, webrtc.RTPCodecTypeAudio); err != nil {
		return nil, fmt.Errorf("failed to register opus codec: %w", err)
	}

	// Register VP9 for screen sharing video
	if err := mediaEngine.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:    webrtc.MimeTypeVP9,
			ClockRate:   90000,
			SDPFmtpLine: "profile-id=0",
		},
		PayloadType: 98,
	}, webrtc.RTPCodecTypeVideo); err != nil {
		return nil, fmt.Errorf("failed to register VP9 codec: %w", err)
	}

	api := webrtc.NewAPI(
		webrtc.WithSettingEngine(settingEngine),
		webrtc.WithMediaEngine(mediaEngine),
	)

	return &SFU{
		config:                config,
		api:                   api,
		peers:                 make(map[string]*Peer),
		pendingRenegotiations: make(map[string]bool),
	}, nil
}

func (s *SFU) SetSignalingCallback(cb SignalingCallback) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.signalingCallback = cb
}

func (s *SFU) SetVideoTrackCallback(cb VideoTrackCallback) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onVideoTrackCallback = cb
}

// SetScreenShareManager sets the screen share manager reference for collision handling
func (s *SFU) SetScreenShareManager(sm *ScreenShareManager) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.screenShareManager = sm
}

// HasPendingScreenShare checks if a user has a pending screen share (registered but no track yet)
func (s *SFU) HasPendingScreenShare(userID string) bool {
	s.mu.RLock()
	sm := s.screenShareManager
	s.mu.RUnlock()
	if sm == nil {
		return false
	}
	return sm.IsPendingShare(userID)
}

func (s *SFU) AddPeer(userID string) (*Peer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if existing, ok := s.peers[userID]; ok {
		existing.Close()
		delete(s.peers, userID)
	}

	peer, err := NewPeer(userID, s)
	if err != nil {
		return nil, err
	}

	s.peers[userID] = peer
	log.Printf("[SFU] Added peer %s (total: %d)", userID, len(s.peers))
	return peer, nil
}

func (s *SFU) RemovePeer(userID string) {
	s.mu.Lock()
	peer, ok := s.peers[userID]
	if !ok {
		s.mu.Unlock()
		return
	}
	delete(s.peers, userID)
	delete(s.pendingRenegotiations, userID)

	// Collect other peers to update (while still holding lock)
	otherPeers := make(map[string]*Peer)
	for otherUserID, otherPeer := range s.peers {
		if !otherPeer.IsClosed() {
			otherPeers[otherUserID] = otherPeer
		}
	}
	s.mu.Unlock()

	// Close peer outside lock (peer.Close() handles its own synchronization)
	peer.Close()

	// Update other peers (check IsClosed again since state may have changed)
	for otherUserID, otherPeer := range otherPeers {
		if otherPeer.IsClosed() {
			continue
		}
		if err := otherPeer.RemoveAllTracksFrom(userID); err != nil {
			log.Printf("[SFU] Error removing tracks from peer %s: %v", otherUserID, err)
		}
		s.triggerRenegotiation(otherUserID, otherPeer)
	}

	log.Printf("[SFU] Removed peer %s", userID)
}

func (s *SFU) GetPeer(userID string) *Peer {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.peers[userID]
}

func (s *SFU) GetParticipantIDs(excludeUserID string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var ids []string
	for id := range s.peers {
		if id != excludeUserID {
			ids = append(ids, id)
		}
	}
	return ids
}

func (s *SFU) GetConfig() *Config {
	return s.config
}

// GetPeers returns a snapshot of current peers (for screenshare manager)
func (s *SFU) GetPeers() map[string]*Peer {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(map[string]*Peer, len(s.peers))
	for k, v := range s.peers {
		result[k] = v
	}
	return result
}

// TriggerRenegotiation triggers SDP renegotiation for a peer (exported for screenshare)
func (s *SFU) TriggerRenegotiation(userID string) {
	peer := s.GetPeer(userID)
	if peer != nil {
		s.triggerRenegotiation(userID, peer)
	}
}

// SendInitialOffer creates and sends the initial SDP offer to a newly created peer.
// The server always initiates offers to ensure it's the ICE controlling agent.
func (s *SFU) SendInitialOffer(userID string) error {
	peer := s.GetPeer(userID)
	if peer == nil {
		return fmt.Errorf("peer not found: %s", userID)
	}

	s.mu.RLock()
	cb := s.signalingCallback
	s.mu.RUnlock()

	if cb == nil {
		return fmt.Errorf("no signaling callback set")
	}

	offer, err := peer.CreateInitialOffer()
	if err != nil {
		return fmt.Errorf("failed to create initial offer: %w", err)
	}

	if err := peer.SetLocalDescription(offer); err != nil {
		return fmt.Errorf("failed to set local description: %w", err)
	}

	log.Printf("[SFU] Sending initial offer to %s", userID)
	cb(userID, "RTC_OFFER", RtcOfferPayload{SDP: offer.SDP})
	return nil
}

func (s *SFU) HandleOffer(userID string, sdp string) (string, error) {
	log.Printf("[SFU] [DEBUG] HandleOffer from %s - SDP length: %d", userID, len(sdp))
	log.Printf("[SFU] [DEBUG] HandleOffer from %s - has video m-line: %v", userID, strings.Contains(sdp, "m=video"))
	log.Printf("[SFU] [DEBUG] HandleOffer from %s - has audio m-line: %v", userID, strings.Contains(sdp, "m=audio"))

	peer := s.GetPeer(userID)
	if peer == nil {
		log.Printf("[SFU] [DEBUG] HandleOffer from %s - peer not found!", userID)
		return "", NewFatalError(userID, "HandleOffer", ErrPeerNotFound)
	}

	if peer.IsClosed() {
		log.Printf("[SFU] [DEBUG] HandleOffer from %s - peer is closed!", userID)
		return "", NewPeerClosedError(userID, "HandleOffer")
	}

	// Perfect negotiation: server is the "impolite" peer.
	// If we have a pending local offer (not in stable state), ignore the incoming offer.
	// The client (polite peer) will rollback and accept our offer instead.
	// Exception: Accept offer if user has pending screen share (they're sending video track).
	signalingState := peer.SignalingState()
	log.Printf("[SFU] [DEBUG] HandleOffer from %s - current signaling state: %s", userID, signalingState.String())
	log.Printf("[SFU] [DEBUG] HandleOffer from %s - hasPendingScreenShare: %v", userID, s.HasPendingScreenShare(userID))
	if signalingState != webrtc.SignalingStateStable {
		// Accept offer if user has pending screen share (they're trying to send the video track)
		if s.HasPendingScreenShare(userID) {
			log.Printf("[SFU] Accepting offer from %s despite collision - pending screen share", userID)
			// Rollback our pending offer to accept theirs
			if err := peer.Rollback(); err != nil {
				log.Printf("[SFU] Rollback failed for %s: %v", userID, err)
				return "", nil
			}
		} else {
			log.Printf("[SFU] Ignoring offer from %s - offer collision (state: %s, server is impolite peer)", userID, signalingState.String())
			return "", nil
		}
	}

	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  sdp,
	}
	log.Printf("[SFU] [DEBUG] HandleOffer from %s - setting remote description...", userID)
	if err := peer.SetRemoteDescription(offer); err != nil {
		log.Printf("[SFU] [DEBUG] HandleOffer from %s - SetRemoteDescription failed: %v", userID, err)
		if err == ErrPeerNotActive {
			return "", NewPeerClosedError(userID, "HandleOffer.SetRemoteDescription")
		}
		return "", NewTransientError(userID, "HandleOffer.SetRemoteDescription", err)
	}
	log.Printf("[SFU] [DEBUG] HandleOffer from %s - SetRemoteDescription succeeded", userID)

	log.Printf("[SFU] [DEBUG] HandleOffer from %s - creating answer...", userID)
	answer, err := peer.CreateAnswer()
	if err != nil {
		log.Printf("[SFU] [DEBUG] HandleOffer from %s - CreateAnswer failed: %v", userID, err)
		if err == ErrPeerNotActive {
			return "", NewPeerClosedError(userID, "HandleOffer.CreateAnswer")
		}
		return "", NewTransientError(userID, "HandleOffer.CreateAnswer", err)
	}
	log.Printf("[SFU] [DEBUG] HandleOffer from %s - answer created, SDP length: %d", userID, len(answer.SDP))
	log.Printf("[SFU] [DEBUG] HandleOffer from %s - answer has video m-line: %v", userID, strings.Contains(answer.SDP, "m=video"))

	if err := peer.SetLocalDescription(answer); err != nil {
		log.Printf("[SFU] [DEBUG] HandleOffer from %s - SetLocalDescription failed: %v", userID, err)
		if err == ErrPeerNotActive {
			return "", NewPeerClosedError(userID, "HandleOffer.SetLocalDescription")
		}
		return "", NewTransientError(userID, "HandleOffer.SetLocalDescription", err)
	}
	log.Printf("[SFU] [DEBUG] HandleOffer from %s - answer set as local description, returning", userID)

	return answer.SDP, nil
}

// HandleAnswer processes an SDP answer from a client (during renegotiation)
func (s *SFU) HandleAnswer(userID string, sdp string) error {
	peer := s.GetPeer(userID)
	if peer == nil {
		return NewFatalError(userID, "HandleAnswer", ErrPeerNotFound)
	}

	if peer.IsClosed() {
		return NewPeerClosedError(userID, "HandleAnswer")
	}

	answer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP:  sdp,
	}
	if err := peer.SetRemoteDescription(answer); err != nil {
		if err == ErrPeerNotActive {
			return NewPeerClosedError(userID, "HandleAnswer.SetRemoteDescription")
		}
		return NewTransientError(userID, "HandleAnswer.SetRemoteDescription", err)
	}

	// Check for pending renegotiation requests now that we're back in stable state
	s.mu.Lock()
	hasPending := s.pendingRenegotiations[userID]
	if hasPending {
		delete(s.pendingRenegotiations, userID)
	}
	s.mu.Unlock()

	if hasPending {
		log.Printf("[SFU] Processing pending renegotiation for %s", userID)
		s.triggerRenegotiation(userID, peer)
	}

	return nil
}

func (s *SFU) HandleICECandidate(userID string, candidate string, sdpMid *string, sdpMLineIndex *uint16) error {
	peer := s.GetPeer(userID)
	if peer == nil {
		return NewFatalError(userID, "HandleICECandidate", ErrPeerNotFound)
	}

	if peer.IsClosed() {
		return NewPeerClosedError(userID, "HandleICECandidate")
	}

	init := webrtc.ICECandidateInit{
		Candidate: candidate,
	}
	if sdpMid != nil {
		init.SDPMid = sdpMid
	}
	if sdpMLineIndex != nil {
		init.SDPMLineIndex = sdpMLineIndex
	}

	if err := peer.AddICECandidate(init); err != nil {
		if err == ErrPeerNotActive {
			return NewPeerClosedError(userID, "HandleICECandidate.AddICECandidate")
		}
		return NewTransientError(userID, "HandleICECandidate.AddICECandidate", err)
	}
	return nil
}

func (s *SFU) OnIceCandidate(userID string, candidate *webrtc.ICECandidate) {
	s.mu.RLock()
	cb := s.signalingCallback
	s.mu.RUnlock()

	if cb == nil {
		return
	}

	json := candidate.ToJSON()
	payload := RtcIceCandidatePayload{
		Candidate:     json.Candidate,
		SDPMid:        json.SDPMid,
		SDPMLineIndex: json.SDPMLineIndex,
	}
	cb(userID, "RTC_ICE_CANDIDATE", payload)
}

func (s *SFU) OnPeerTrackReady(userID string, trackKind string, track *webrtc.TrackLocalStaticRTP) {
	// For audio tracks, distribute to all peers
	// For video tracks, only distribute to subscribed peers (handled by screenshare manager)
	if trackKind == "video" {
		log.Printf("[SFU] Video track ready from %s - screenshare manager will handle distribution", userID)
		// Notify screenshare manager via callback
		s.mu.RLock()
		cb := s.onVideoTrackCallback
		s.mu.RUnlock()
		if cb != nil {
			cb(userID, track)
		}
		return
	}

	// Audio track handling - distribute to all peers
	s.mu.RLock()
	otherPeers := make(map[string]*Peer)
	for otherUserID, otherPeer := range s.peers {
		if otherUserID != userID && !otherPeer.IsClosed() {
			otherPeers[otherUserID] = otherPeer
		}
	}
	peer := s.peers[userID]
	s.mu.RUnlock()

	for otherUserID, otherPeer := range otherPeers {
		if otherPeer.IsClosed() {
			continue
		}
		if err := otherPeer.AddTrack(userID, trackKind, track); err != nil {
			log.Printf("[SFU] Error adding track to peer %s: %v", otherUserID, err)
		}
		s.triggerRenegotiation(otherUserID, otherPeer)
	}

	if peer != nil && !peer.IsClosed() {
		addedTracks := 0
		for sourceUserID, sourcePeer := range otherPeers {
			sourceTrack := sourcePeer.GetLocalTrack("audio")
			if sourceTrack == nil {
				continue
			}
			if err := peer.AddTrack(sourceUserID, "audio", sourceTrack); err != nil {
				log.Printf("[SFU] Error adding existing track from %s to new peer %s: %v", sourceUserID, userID, err)
			}
			addedTracks++
		}
		if addedTracks > 0 {
			s.triggerRenegotiation(userID, peer)
		}
	}
}

func (s *SFU) triggerRenegotiation(userID string, peer *Peer) {
	s.mu.Lock()
	cb := s.signalingCallback
	if cb == nil || peer.IsClosed() {
		s.mu.Unlock()
		return
	}

	if !peer.NeedsRenegotiation() {
		// Mark for later - will be processed when HandleAnswer brings us to stable state
		s.pendingRenegotiations[userID] = true
		s.mu.Unlock()
		log.Printf("[SFU] Queued renegotiation for %s - not in stable state", userID)
		return
	}

	// Clear pending flag since we're doing it now
	delete(s.pendingRenegotiations, userID)
	s.mu.Unlock()

	offer, err := peer.CreateOffer()
	if err != nil {
		log.Printf("[SFU] Error creating offer for %s: %v", userID, err)
		return
	}

	if err := peer.SetLocalDescription(offer); err != nil {
		log.Printf("[SFU] Error setting local description for %s: %v", userID, err)
		return
	}

	log.Printf("[SFU] Sending renegotiation offer to %s", userID)
	cb(userID, "RTC_OFFER", RtcOfferPayload{SDP: offer.SDP})
}

func (s *SFU) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()

	for userID, peer := range s.peers {
		peer.Close()
		delete(s.peers, userID)
	}
	log.Printf("[SFU] Closed all peer connections")
}
