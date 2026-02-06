package sfu

import (
	"log"
	"sync"

	"github.com/pion/webrtc/v4"
)

// ScreenShareState tracks the state of an active screen share
type ScreenShareState struct {
	UserID   string
	Track    *webrtc.TrackLocalStaticRTP
	HasTrack bool // true once the video track has actually arrived
}

// ScreenShareManager manages screen share streams and subscriptions
type ScreenShareManager struct {
	sfu              *SFU
	mu               sync.RWMutex
	activeStreams    map[string]*ScreenShareState // streamerID -> state
	subscriptions    map[string]string            // viewerID -> streamerID
	streamerViewers  map[string]map[string]bool   // streamerID -> set of viewerIDs
	pendingKeyframes map[string]string            // viewerID -> streamerID (pending keyframe requests)
	onUpdateCallback func(userID string, streaming bool)
}

func NewScreenShareManager(sfu *SFU) *ScreenShareManager {
	sm := &ScreenShareManager{
		sfu:              sfu,
		activeStreams:    make(map[string]*ScreenShareState),
		subscriptions:    make(map[string]string),
		streamerViewers:  make(map[string]map[string]bool),
		pendingKeyframes: make(map[string]string),
	}

	// Register callback for video tracks
	sfu.SetVideoTrackCallback(sm.onVideoTrackReady)

	return sm
}

func (sm *ScreenShareManager) SetUpdateCallback(cb func(userID string, streaming bool)) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.onUpdateCallback = cb
}

// The broadcast to clients happens later when the video track actually arrives
func (sm *ScreenShareManager) StartShare(userID string) {
	sm.mu.Lock()

	// Only register if not already registered
	if _, exists := sm.activeStreams[userID]; exists {
		sm.mu.Unlock()
		return
	}

	// Check if peer already has a video track from a previous share in this session
	// (This happens when client uses replaceTrack() instead of addTrack())
	peer := sm.sfu.GetPeer(userID)
	var existingTrack *webrtc.TrackLocalStaticRTP
	if peer != nil {
		existingTrack = peer.GetLocalTrack("video")
	}

	// Create state with HasTrack=false until track arrives (or is reused)
	sm.activeStreams[userID] = &ScreenShareState{
		UserID:   userID,
		Track:    nil,
		HasTrack: false,
	}
	sm.streamerViewers[userID] = make(map[string]bool)
	sm.mu.Unlock()

	// If peer already has a video track, reuse it immediately
	// (Client used replaceTrack() so OnTrack won't fire again)
	if existingTrack != nil {
		log.Printf("[ScreenShare] User %s reusing existing video track (replaceTrack pattern)", userID)
		sm.onVideoTrackReady(userID, existingTrack)
		return
	}

	log.Printf("[ScreenShare] User %s registered for streaming, waiting for video track", userID)
	// NOTE: We do NOT broadcast here - wait for onVideoTrackReady
}

func (sm *ScreenShareManager) StopShare(userID string) {
	sm.mu.Lock()
	state, wasStreaming := sm.activeStreams[userID]
	if !wasStreaming {
		sm.mu.Unlock()
		return
	}

	// Check if we ever actually started streaming (had a track)
	hadTrack := state != nil && state.HasTrack

	// Get list of viewers to clean up
	viewers := sm.streamerViewers[userID]
	viewerIDs := make([]string, 0, len(viewers))
	for viewerID := range viewers {
		viewerIDs = append(viewerIDs, viewerID)
	}

	delete(sm.activeStreams, userID)
	delete(sm.streamerViewers, userID)

	// Clean up subscriptions
	for _, viewerID := range viewerIDs {
		delete(sm.subscriptions, viewerID)
	}

	cb := sm.onUpdateCallback
	sm.mu.Unlock()

	// Remove video tracks from viewers
	for _, viewerID := range viewerIDs {
		sm.removeVideoTrackFromViewer(userID, viewerID)
	}

	log.Printf("[ScreenShare] User %s stopped screen share", userID)

	// Only broadcast if we actually had a track (were actively streaming)
	if cb != nil && hadTrack {
		cb(userID, false)
	}
}

func (sm *ScreenShareManager) Subscribe(viewerID, streamerID string) error {
	sm.mu.Lock()
	state, exists := sm.activeStreams[streamerID]
	if !exists {
		sm.mu.Unlock()
		log.Printf("[ScreenShare] Subscribe failed: %s is not streaming", streamerID)
		return nil
	}

	// Check if the track is actually ready
	if state == nil || !state.HasTrack {
		sm.mu.Unlock()
		log.Printf("[ScreenShare] Subscribe failed: %s's video track not yet ready", streamerID)
		return nil
	}

	// Unsubscribe from current stream if any
	if currentStreamer, isSubscribed := sm.subscriptions[viewerID]; isSubscribed && currentStreamer != streamerID {
		delete(sm.streamerViewers[currentStreamer], viewerID)
		sm.mu.Unlock()
		sm.removeVideoTrackFromViewer(currentStreamer, viewerID)
		sm.mu.Lock()

		// Re-validate after relock — stream may have stopped while unlocked
		state, exists = sm.activeStreams[streamerID]
		if !exists || state == nil || !state.HasTrack {
			sm.mu.Unlock()
			log.Printf("[ScreenShare] Subscribe aborted: %s's stream ended during unsubscribe", streamerID)
			return nil
		}
	}

	sm.subscriptions[viewerID] = streamerID
	if sm.streamerViewers[streamerID] == nil {
		sm.streamerViewers[streamerID] = make(map[string]bool)
	}
	sm.streamerViewers[streamerID][viewerID] = true
	track := state.Track
	sm.mu.Unlock()

	// Add video track to viewer
	if track != nil {
		sm.addVideoTrackToViewer(streamerID, viewerID, track)
	}

	log.Printf("[ScreenShare] User %s subscribed to %s's stream", viewerID, streamerID)
	return nil
}

func (sm *ScreenShareManager) Unsubscribe(viewerID string) {
	sm.mu.Lock()
	streamerID, isSubscribed := sm.subscriptions[viewerID]
	if !isSubscribed {
		sm.mu.Unlock()
		return
	}

	delete(sm.subscriptions, viewerID)
	delete(sm.pendingKeyframes, viewerID)
	if sm.streamerViewers[streamerID] != nil {
		delete(sm.streamerViewers[streamerID], viewerID)
	}
	sm.mu.Unlock()

	sm.removeVideoTrackFromViewer(streamerID, viewerID)
	log.Printf("[ScreenShare] User %s unsubscribed from %s's stream", viewerID, streamerID)
}

func (sm *ScreenShareManager) OnUserDisconnect(userID string) {
	// Stop sharing if user was streaming
	sm.StopShare(userID)

	// Unsubscribe if user was viewing
	sm.Unsubscribe(userID)
}

func (sm *ScreenShareManager) IsStreaming(userID string) bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	state, exists := sm.activeStreams[userID]
	return exists && state != nil && state.HasTrack
}

func (sm *ScreenShareManager) IsPendingShare(userID string) bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	state, exists := sm.activeStreams[userID]
	return exists && !state.HasTrack
}

func (sm *ScreenShareManager) GetActiveStreamers() []string {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	streamers := make([]string, 0, len(sm.activeStreams))
	for id, state := range sm.activeStreams {
		if state != nil && state.HasTrack {
			streamers = append(streamers, id)
		}
	}
	return streamers
}

// onVideoTrackReady is called when a video track arrives from a peer
func (sm *ScreenShareManager) onVideoTrackReady(userID string, track *webrtc.TrackLocalStaticRTP) {
	sm.mu.Lock()
	state, isRegistered := sm.activeStreams[userID]

	// Auto-register if video track arrives before SCREENSHARE_START (race condition fix)
	if !isRegistered {
		log.Printf("[ScreenShare] Auto-registering %s (video track arrived before SCREENSHARE_START)", userID)
		state = &ScreenShareState{
			UserID:   userID,
			Track:    nil,
			HasTrack: false,
		}
		sm.activeStreams[userID] = state
		sm.streamerViewers[userID] = make(map[string]bool)
	}

	// Update state with the track
	state.Track = track
	state.HasTrack = true

	viewers := make([]string, 0, len(sm.streamerViewers[userID]))
	for viewerID := range sm.streamerViewers[userID] {
		viewers = append(viewers, viewerID)
	}
	cb := sm.onUpdateCallback
	sm.mu.Unlock()

	log.Printf("[ScreenShare] Video track ready from %s, now actively streaming", userID)

	// NOW broadcast that the user is streaming (track is ready)
	if cb != nil {
		cb(userID, true)
	}

	// Distribute track to any existing subscribers
	if len(viewers) > 0 {
		log.Printf("[ScreenShare] Distributing video track to %d waiting viewers", len(viewers))
		for _, viewerID := range viewers {
			sm.addVideoTrackToViewer(userID, viewerID, track)
		}
	}
}

func (sm *ScreenShareManager) addVideoTrackToViewer(streamerID, viewerID string, track *webrtc.TrackLocalStaticRTP) {
	peer := sm.sfu.GetPeer(viewerID)
	if peer == nil || peer.IsClosed() {
		return
	}

	if err := peer.AddTrack(streamerID, "video", track); err != nil {
		log.Printf("[ScreenShare] Error adding video track to %s: %v", viewerID, err)
		return
	}

	// Store pending keyframe request - will be triggered after renegotiation completes
	sm.mu.Lock()
	sm.pendingKeyframes[viewerID] = streamerID
	sm.mu.Unlock()

	sm.sfu.TriggerRenegotiation(viewerID)
}

// OnRenegotiationComplete is called when a viewer's SDP answer is received
// This triggers any pending keyframe requests now that the viewer is ready
func (sm *ScreenShareManager) OnRenegotiationComplete(viewerID string) {
	sm.mu.Lock()
	streamerID, hasPending := sm.pendingKeyframes[viewerID]
	if hasPending {
		delete(sm.pendingKeyframes, viewerID)
	}
	sm.mu.Unlock()

	if !hasPending {
		return
	}

	// Now request keyframe from streamer - viewer is ready to receive
	streamerPeer := sm.sfu.GetPeer(streamerID)
	if streamerPeer != nil && !streamerPeer.IsClosed() {
		if err := streamerPeer.RequestKeyframe(); err != nil {
			log.Printf("[ScreenShare] Error requesting keyframe from %s: %v", streamerID, err)
		} else {
			log.Printf("[ScreenShare] Requested keyframe from %s for viewer %s", streamerID, viewerID)
		}
	}
}

func (sm *ScreenShareManager) removeVideoTrackFromViewer(streamerID, viewerID string) {
	peer := sm.sfu.GetPeer(viewerID)
	if peer == nil || peer.IsClosed() {
		return
	}

	if err := peer.RemoveTrack(streamerID, "video"); err != nil {
		log.Printf("[ScreenShare] Error removing video track from %s: %v", viewerID, err)
		return
	}

	sm.sfu.TriggerRenegotiation(viewerID)
}
