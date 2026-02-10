package ws

import (
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"

	"lobby/internal/auth"
	"lobby/internal/config"
	"lobby/internal/constants"
	"lobby/internal/db"
	"lobby/internal/sfu"
)

const (
	// maxDroppedMessagesBeforeDisconnect is the threshold for disconnecting slow clients
	maxDroppedMessagesBeforeDisconnect = 100
)

// registerRequest is used for synchronous registration with a callback
type registerRequest struct {
	client *Client
	done   chan struct{}
}

// VoiceState tracks a user's voice channel state
type VoiceState struct {
	Muted    bool
	Deafened bool
}

type Hub struct {
	clients           map[*Client]bool
	userClients       map[string]*Client
	voiceParticipants map[string]*VoiceState
	broadcast         chan *WSMessage
	registerSync      chan registerRequest
	unregister        chan *Client
	shutdown          chan struct{}
	jwtService        *auth.JWTService
	userRepo          *db.UserRepository
	messageRepo       *db.MessageRepository
	sfu               *sfu.SFU
	sfuCfg            *config.SFUConfig
	screenShare       *sfu.ScreenShareManager
	sequence          int64
	mu                sync.RWMutex
}

func NewHub(jwtService *auth.JWTService, userRepo *db.UserRepository, messageRepo *db.MessageRepository, sfuCfg *config.SFUConfig) (*Hub, error) {
	h := &Hub{
		clients:           make(map[*Client]bool),
		userClients:       make(map[string]*Client),
		voiceParticipants: make(map[string]*VoiceState),
		broadcast:         make(chan *WSMessage, constants.WSBroadcastBufferSize),
		registerSync:      make(chan registerRequest),
		unregister:        make(chan *Client),
		shutdown:          make(chan struct{}),
		jwtService:        jwtService,
		userRepo:          userRepo,
		messageRepo:       messageRepo,
		sfuCfg:            sfuCfg,
		sequence:          0,
	}

	// Initialize SFU
	sfuConfig := &sfu.Config{
		PublicIP: sfuCfg.PublicIP,
		MinPort:  sfuCfg.MinPort,
		MaxPort:  sfuCfg.MaxPort,
	}
	if sfuCfg.TURN.Host != "" {
		sfuConfig.STUNUrl = fmt.Sprintf("stun:%s:%d", sfuCfg.TURN.Host, sfuCfg.TURN.Port)
	}

	sfuInstance, err := sfu.New(sfuConfig)
	if err != nil {
		return nil, fmt.Errorf("creating SFU: %w", err)
	}
	h.sfu = sfuInstance
	h.sfu.SetSignalingCallback(h.handleSfuSignaling)
	slog.Info("SFU initialized", "component", "hub")

	// Initialize screen share manager
	h.screenShare = sfu.NewScreenShareManager(sfuInstance)
	h.screenShare.SetUpdateCallback(h.handleScreenShareUpdate)
	sfuInstance.SetScreenShareManager(h.screenShare)
	slog.Info("screenshare manager initialized", "component", "hub")

	return h, nil
}

func (h *Hub) Run() {
	for {
		select {
		case <-h.shutdown:
			h.mu.Lock()
			for client := range h.clients {
				client.CloseSend()
				delete(h.clients, client)
			}
			h.mu.Unlock()
			if h.sfu != nil {
				h.sfu.Close()
			}
			slog.Info("shutdown complete", "component", "hub")
			return

		case req := <-h.registerSync:
			h.mu.Lock()
			h.clients[req.client] = true
			wasInVoice := false
			var replacedUserID string
			if req.client.user != nil {
				replacedUserID = req.client.user.ID
				if old, ok := h.userClients[replacedUserID]; ok && old != req.client {
					// Notify old client before closing so it knows not to retry
					select {
					case old.send <- &WSMessage{Op: OpInvalidSession, Data: InvalidSessionPayload{Resumable: false}}:
					default:
					}
					if _, inVoice := h.voiceParticipants[replacedUserID]; inVoice {
						delete(h.voiceParticipants, replacedUserID)
						wasInVoice = true
					}
					old.Close()
					delete(h.clients, old)
				}
				h.userClients[replacedUserID] = req.client
			}
			h.mu.Unlock()

			if wasInVoice {
				h.cleanupVoiceForUser(replacedUserID)
			}

			close(req.done)

			if req.client.user != nil {
				h.BroadcastDispatchExcept(EventUserJoined, UserJoinedPayload{
					Member: MemberState{
						ID:        req.client.user.ID,
						Username:  req.client.user.Username,
						Avatar:    req.client.user.GetAvatarURL(),
						Status:    req.client.GetStatus(),
						CreatedAt: req.client.user.CreatedAt,
					},
				}, req.client)
			}

		case client := <-h.unregister:
			h.mu.Lock()
			wasInVoice := false
			wasActiveClient := false
			var userID string
			if client.user != nil {
				userID = client.user.ID
				wasActiveClient = h.userClients[userID] == client
				// Only clean up voice if this is still the active client
				// (not already replaced by registerSync)
				if wasActiveClient {
					if _, inVoice := h.voiceParticipants[userID]; inVoice {
						delete(h.voiceParticipants, userID)
						wasInVoice = true
					}
				}
			}
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				if client.user != nil {
					if h.userClients[client.user.ID] == client {
						delete(h.userClients, client.user.ID)
					}
				}
				client.CloseSend()
			}
			h.mu.Unlock()

			if wasInVoice {
				h.cleanupVoiceForUser(userID)
			}

			if client.user != nil && wasActiveClient {
				h.broadcastPresenceUpdate(client.user.ID, "offline", nil)
				h.BroadcastDispatch(EventUserLeft, UserLeftPayload{
					UserID: client.user.ID,
				})
			}

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				h.sendToClientLocked(client, message)
			}
			h.mu.RUnlock()
		}
	}
}

// Caller must hold at least a read lock on h.mu.
func (h *Hub) sendToClientLocked(client *Client, msg *WSMessage) {
	if !client.IsIdentified() {
		return
	}
	select {
	case client.send <- msg:
		// Message sent successfully
	default:
		// Client buffer full - track the drop
		dropped := atomic.AddInt64(&client.DroppedMessages, 1)
		userID := "unknown"
		if client.user != nil {
			userID = client.user.ID
		}

		// Log warning periodically (every 10 drops)
		if dropped%10 == 1 {
			slog.Warn("dropped messages for slow client", "component", "hub", "dropped", dropped, "user_id", userID)
		}

		// Disconnect clients that fall too far behind
		if dropped >= maxDroppedMessagesBeforeDisconnect {
			slog.Warn("disconnecting slow client", "component", "hub", "user_id", userID, "dropped", dropped)
			// Close will be handled by the client's pumps
			client.Close()
		}
	}
}

func (h *Hub) nextSequence() int64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.sequence++
	return h.sequence
}

func (h *Hub) Broadcast(msg *WSMessage) {
	h.broadcast <- msg
}

// BroadcastDispatch sends a DISPATCH message to all clients with sequence number
func (h *Hub) BroadcastDispatch(eventType string, data interface{}) {
	seq := h.nextSequence()
	msg := &WSMessage{
		Op:   OpDispatch,
		Type: eventType,
		Data: data,
		Seq:  &seq,
	}
	h.broadcast <- msg
}

// BroadcastExcept sends a message to all clients except the specified one
func (h *Hub) BroadcastExcept(msg *WSMessage, except *Client) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		if client == except {
			continue
		}
		h.sendToClientLocked(client, msg)
	}
}

// BroadcastDispatchExcept sends a DISPATCH to all clients except one
func (h *Hub) BroadcastDispatchExcept(eventType string, data interface{}, except *Client) {
	seq := h.nextSequence()
	msg := &WSMessage{
		Op:   OpDispatch,
		Type: eventType,
		Data: data,
		Seq:  &seq,
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		if client == except {
			continue
		}
		h.sendToClientLocked(client, msg)
	}
}

func (h *Hub) SendToUser(userID string, msg *WSMessage) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if client, ok := h.userClients[userID]; ok {
		h.sendToClientLocked(client, msg)
	}
}

func (h *Hub) GetOnlineMembers() []MemberState {
	h.mu.RLock()
	defer h.mu.RUnlock()

	members := make([]MemberState, 0, len(h.clients))
	for client := range h.clients {
		if !client.IsIdentified() {
			continue
		}

		// Include voice state from voiceParticipants
		inVoice := false
		muted := false
		deafened := false
		if voiceState, ok := h.voiceParticipants[client.user.ID]; ok {
			inVoice = true
			muted = voiceState.Muted
			deafened = voiceState.Deafened
		}

		// Check streaming state
		streaming := false
		if h.screenShare != nil {
			streaming = h.screenShare.IsStreaming(client.user.ID)
		}

		members = append(members, MemberState{
			ID:        client.user.ID,
			Username:  client.user.Username,
			Avatar:    client.user.GetAvatarURL(),
			Status:    client.GetStatus(),
			InVoice:   inVoice,
			Muted:     muted,
			Deafened:  deafened,
			Streaming: streaming,
			CreatedAt: client.user.CreatedAt,
		})
	}
	return members
}

func (h *Hub) GetClient(userID string) *Client {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.userClients[userID]
}

func (h *Hub) IsUserOnline(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := h.userClients[userID]
	return ok
}

// If except is not nil, that client won't receive the message
func (h *Hub) broadcastPresenceUpdate(userID string, status string, except *Client) {
	seq := h.nextSequence()
	msg := &WSMessage{
		Op:   OpDispatch,
		Type: EventPresenceUpdate,
		Data: PresenceUpdatePayload{
			UserID: userID,
			Status: status,
		},
		Seq: &seq,
	}

	h.mu.RLock()
	for client := range h.clients {
		// Don't send to the excluded client
		if except != nil && client == except {
			continue
		}
		h.sendToClientLocked(client, msg)
	}
	h.mu.RUnlock()

	slog.Debug("presence changed", "component", "hub", "user_id", userID, "status", status)
}

func (h *Hub) MessageRepo() *db.MessageRepository {
	return h.messageRepo
}

func (h *Hub) UserRepo() *db.UserRepository {
	return h.userRepo
}

func (h *Hub) SetUserVoiceState(userID string, state *VoiceState) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.voiceParticipants[userID] = state
}

func (h *Hub) RemoveUserFromVoice(userID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.voiceParticipants, userID)
}

func (h *Hub) GetUserVoiceState(userID string) *VoiceState {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.voiceParticipants[userID]
}

// UpdateUserVoiceState atomically updates a user's voice state fields.
// Only updates fields that are non-nil. Returns the updated state, or nil if user not in voice.
func (h *Hub) UpdateUserVoiceState(userID string, muted, deafened *bool) *VoiceState {
	h.mu.Lock()
	defer h.mu.Unlock()

	state, exists := h.voiceParticipants[userID]
	if !exists {
		return nil
	}

	if muted != nil {
		state.Muted = *muted
	}
	if deafened != nil {
		state.Deafened = *deafened
	}

	// Return a copy to avoid race conditions with the map value
	return &VoiceState{
		Muted:    state.Muted,
		Deafened: state.Deafened,
	}
}

func (h *Hub) GetVoiceParticipantIDs(excludeUserID string) []string {
	h.mu.RLock()
	defer h.mu.RUnlock()

	var ids []string
	for id := range h.voiceParticipants {
		if id != excludeUserID {
			ids = append(ids, id)
		}
	}
	return ids
}

func (h *Hub) GetSFU() *sfu.SFU {
	return h.sfu
}

func (h *Hub) GetSFUConfig() *config.SFUConfig {
	return h.sfuCfg
}

func (h *Hub) HandleRtcOffer(userID string, sdp string) (string, error) {
	if h.sfu == nil {
		return "", fmt.Errorf("SFU not initialized")
	}
	answer, err := h.sfu.HandleOffer(userID, sdp)
	if err != nil {
		h.handleSfuError(userID, err)
		return "", err
	}
	return answer, nil
}

func (h *Hub) HandleRtcAnswer(userID string, sdp string) error {
	if h.sfu == nil {
		return fmt.Errorf("SFU not initialized")
	}
	if err := h.sfu.HandleAnswer(userID, sdp); err != nil {
		h.handleSfuError(userID, err)
		return err
	}
	// Notify screenshare manager that renegotiation is complete
	// This triggers any pending keyframe requests
	if h.screenShare != nil {
		h.screenShare.OnRenegotiationComplete(userID)
	}
	return nil
}

func (h *Hub) HandleRtcIceCandidate(userID string, candidate string, sdpMid *string, sdpMLineIndex *uint16) error {
	if h.sfu == nil {
		return fmt.Errorf("SFU not initialized")
	}
	if err := h.sfu.HandleICECandidate(userID, candidate, sdpMid, sdpMLineIndex); err != nil {
		h.handleSfuError(userID, err)
		return err
	}
	return nil
}

// handleSfuError processes SFU errors based on their category
func (h *Hub) handleSfuError(userID string, err error) {
	var peerErr *sfu.PeerError
	if !errors.As(err, &peerErr) {
		// Not a categorized error, log it
		slog.Error("SFU error", "component", "hub", "user_id", userID, "error", err)
		return
	}

	switch peerErr.Kind {
	case sfu.ErrKindPeerClosed:
		// Normal closure, no action needed
	case sfu.ErrKindTransient:
		slog.Warn("transient SFU error", "component", "hub", "user_id", userID, "error", err)
	case sfu.ErrKindFatal:
		slog.Error("fatal SFU error", "component", "hub", "user_id", userID, "error", err)
		// Clean up the peer on fatal errors
		h.sfu.RemovePeer(userID)
	}
}

// handleSfuSignaling is called by the SFU when it needs to send signaling messages
func (h *Hub) handleSfuSignaling(userID string, eventType string, payload interface{}) {
	seq := h.nextSequence()
	msg := &WSMessage{
		Op:   OpDispatch,
		Type: eventType,
		Data: payload,
		Seq:  &seq,
	}
	h.SendToUser(userID, msg)
}

// SendDispatchToUser sends a DISPATCH message to a specific user
func (h *Hub) SendDispatchToUser(userID string, eventType string, payload interface{}) {
	seq := h.nextSequence()
	msg := &WSMessage{
		Op:   OpDispatch,
		Type: eventType,
		Data: payload,
		Seq:  &seq,
	}
	h.SendToUser(userID, msg)
}

func (h *Hub) Shutdown() {
	close(h.shutdown)
}

// GetScreenShareManager returns the screen share manager
func (h *Hub) GetScreenShareManager() *sfu.ScreenShareManager {
	return h.screenShare
}

// handleScreenShareUpdate is called when a user's screen share state changes
func (h *Hub) handleScreenShareUpdate(userID string, streaming bool) {
	h.BroadcastDispatch(EventScreenShareUpdate, ScreenShareUpdatePayload{
		UserID:    userID,
		Streaming: streaming,
	})
}

// cleanupVoiceForUser tears down SFU peer, screen share, and broadcasts voice-leave.
// Must be called outside of h.mu lock.
func (h *Hub) cleanupVoiceForUser(userID string) {
	if h.sfu != nil {
		h.sfu.RemovePeer(userID)
	}
	if h.screenShare != nil {
		h.screenShare.OnUserDisconnect(userID)
	}
	h.BroadcastDispatch(EventVoiceStateUpdate, VoiceStateUpdatePayload{
		UserID:   userID,
		InVoice:  false,
		Muted:    false,
		Deafened: false,
	})
}

// IsUserInVoice returns true if the user is currently in voice
func (h *Hub) IsUserInVoice(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := h.voiceParticipants[userID]
	return ok
}
