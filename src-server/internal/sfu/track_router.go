package sfu

import (
	"log"
	"sync"

	"github.com/pion/webrtc/v4"
)

type TrackRouter struct {
	mu sync.RWMutex
	// tracks maps userID -> their audio track
	tracks map[string]*webrtc.TrackLocalStaticRTP
}

func NewTrackRouter() *TrackRouter {
	return &TrackRouter{
		tracks: make(map[string]*webrtc.TrackLocalStaticRTP),
	}
}

func (r *TrackRouter) AddTrack(userID string, track *webrtc.TrackLocalStaticRTP) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tracks[userID] = track
	log.Printf("[TrackRouter] Added track for user %s", userID)
}

func (r *TrackRouter) RemoveTrack(userID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.tracks, userID)
	log.Printf("[TrackRouter] Removed track for user %s", userID)
}

func (r *TrackRouter) GetTrack(userID string) *webrtc.TrackLocalStaticRTP {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.tracks[userID]
}

func (r *TrackRouter) GetAllTracksExcept(excludeUserID string) map[string]*webrtc.TrackLocalStaticRTP {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make(map[string]*webrtc.TrackLocalStaticRTP)
	for userID, track := range r.tracks {
		if userID != excludeUserID {
			result[userID] = track
		}
	}
	return result
}

func (r *TrackRouter) GetTrackCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.tracks)
}
