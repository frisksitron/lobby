package sfu

import (
	"fmt"
	"log"
	"sync"

	"github.com/pion/webrtc/v4"
)

// SignalingCallback is called when the SFU needs to send a message to a client
type SignalingCallback func(userID string, eventType string, payload interface{})

// SFU manages WebRTC peer connections for voice chat
type SFU struct {
	config *Config
	api    *webrtc.API
	mu     sync.RWMutex

	// peers maps userID -> peer connection
	peers map[string]*Peer

	// trackRouter manages track forwarding
	trackRouter *TrackRouter

	// signalingCallback is called to send messages to clients
	signalingCallback SignalingCallback
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
	if err := mediaEngine.RegisterDefaultCodecs(); err != nil {
		return nil, fmt.Errorf("failed to register codecs: %w", err)
	}

	api := webrtc.NewAPI(
		webrtc.WithSettingEngine(settingEngine),
		webrtc.WithMediaEngine(mediaEngine),
	)

	return &SFU{
		config:      config,
		api:         api,
		peers:       make(map[string]*Peer),
		trackRouter: NewTrackRouter(),
	}, nil
}

// SetSignalingCallback sets the callback for sending signaling messages
func (s *SFU) SetSignalingCallback(cb SignalingCallback) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.signalingCallback = cb
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

	// Remove from track router
	s.trackRouter.RemoveTrack(userID)

	// Update other peers (check IsClosed again since state may have changed)
	for otherUserID, otherPeer := range otherPeers {
		if otherPeer.IsClosed() {
			continue
		}
		if err := otherPeer.RemoveTrack(userID); err != nil {
			log.Printf("[SFU] Error removing track from peer %s: %v", otherUserID, err)
		}
		s.triggerRenegotiation(otherUserID, otherPeer)
	}

	log.Printf("[SFU] Removed peer %s", userID)
}

// GetPeer returns a peer by user ID
func (s *SFU) GetPeer(userID string) *Peer {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.peers[userID]
}

// GetParticipantIDs returns IDs of all participants except the specified user
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

// GetConfig returns the SFU configuration
func (s *SFU) GetConfig() *Config {
	return s.config
}

func (s *SFU) HandleOffer(userID string, sdp string) (string, error) {
	peer := s.GetPeer(userID)
	if peer == nil {
		return "", NewFatalError(userID, "HandleOffer", ErrPeerNotFound)
	}

	if peer.IsClosed() {
		return "", NewPeerClosedError(userID, "HandleOffer")
	}

	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  sdp,
	}
	if err := peer.SetRemoteDescription(offer); err != nil {
		if err == ErrPeerNotActive {
			return "", NewPeerClosedError(userID, "HandleOffer.SetRemoteDescription")
		}
		return "", NewTransientError(userID, "HandleOffer.SetRemoteDescription", err)
	}

	answer, err := peer.CreateAnswer()
	if err != nil {
		if err == ErrPeerNotActive {
			return "", NewPeerClosedError(userID, "HandleOffer.CreateAnswer")
		}
		return "", NewTransientError(userID, "HandleOffer.CreateAnswer", err)
	}

	if err := peer.SetLocalDescription(answer); err != nil {
		if err == ErrPeerNotActive {
			return "", NewPeerClosedError(userID, "HandleOffer.SetLocalDescription")
		}
		return "", NewTransientError(userID, "HandleOffer.SetLocalDescription", err)
	}

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
	return nil
}

// HandleICECandidate adds an ICE candidate from a client
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

// OnIceCandidate is called when a peer generates an ICE candidate
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

func (s *SFU) OnPeerTrackReady(userID string, track *webrtc.TrackLocalStaticRTP) {
	s.trackRouter.AddTrack(userID, track)

	// Collect peers and their IDs under lock, then operate outside lock
	// This avoids holding the lock during potentially slow operations
	s.mu.RLock()
	otherPeers := make(map[string]*Peer)
	for otherUserID, otherPeer := range s.peers {
		if otherUserID != userID && !otherPeer.IsClosed() {
			otherPeers[otherUserID] = otherPeer
		}
	}
	peer := s.peers[userID]
	s.mu.RUnlock()

	// Add track to all other peers
	for otherUserID, otherPeer := range otherPeers {
		if otherPeer.IsClosed() {
			continue
		}
		if err := otherPeer.AddTrack(userID, track); err != nil {
			log.Printf("[SFU] Error adding track to peer %s: %v", otherUserID, err)
		}
		s.triggerRenegotiation(otherUserID, otherPeer)
	}

	// Add existing tracks to the new peer
	if peer != nil && !peer.IsClosed() {
		existingTracks := s.trackRouter.GetAllTracksExcept(userID)
		for sourceUserID, sourceTrack := range existingTracks {
			if err := peer.AddTrack(sourceUserID, sourceTrack); err != nil {
				log.Printf("[SFU] Error adding existing track from %s to new peer %s: %v", sourceUserID, userID, err)
			}
		}
		if len(existingTracks) > 0 {
			s.triggerRenegotiation(userID, peer)
		}
	}
}

// OnPeerClosed is called when a peer connection is closed
func (s *SFU) OnPeerClosed(userID string) {
	s.trackRouter.RemoveTrack(userID)
}

// triggerRenegotiation sends a new offer to a peer
func (s *SFU) triggerRenegotiation(userID string, peer *Peer) {
	s.mu.RLock()
	cb := s.signalingCallback
	s.mu.RUnlock()

	if cb == nil || peer.IsClosed() {
		return
	}

	// Only renegotiate if in stable state
	if !peer.NeedsRenegotiation() {
		log.Printf("[SFU] Skipping renegotiation for %s - not in stable state", userID)
		return
	}

	// Create new offer
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

// Close shuts down the SFU and closes all peer connections
func (s *SFU) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()

	for userID, peer := range s.peers {
		peer.Close()
		delete(s.peers, userID)
	}
	log.Printf("[SFU] Closed all peer connections")
}
