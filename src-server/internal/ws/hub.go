package ws

import (
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"lobby/internal/auth"
	"lobby/internal/config"
	"lobby/internal/constants"
	"lobby/internal/db"
	"lobby/internal/sfu"
)

const (
	// maxDroppedMessagesBeforeDisconnect is the threshold for disconnecting slow clients
	maxDroppedMessagesBeforeDisconnect = 100
	voiceJoinWatchdogInterval          = 2 * time.Second
	voiceJoinWatchdogTimeout           = 12 * time.Second
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

type VoiceLifecycleState string

const (
	VoiceLifecycleNotInVoice VoiceLifecycleState = "not_in_voice"
	VoiceLifecycleJoining    VoiceLifecycleState = "joining"
	VoiceLifecycleActive     VoiceLifecycleState = "active"
	VoiceLifecycleLeaving    VoiceLifecycleState = "leaving"
)

type VoiceSession struct {
	State    VoiceLifecycleState
	Muted    bool
	Deafened bool
	JoinedAt time.Time
}

func isValidVoiceTransition(from, to VoiceLifecycleState) bool {
	switch from {
	case VoiceLifecycleNotInVoice:
		return to == VoiceLifecycleJoining
	case VoiceLifecycleJoining:
		return to == VoiceLifecycleActive || to == VoiceLifecycleLeaving
	case VoiceLifecycleActive:
		return to == VoiceLifecycleLeaving
	case VoiceLifecycleLeaving:
		return to == VoiceLifecycleNotInVoice
	}
	return false
}

type Hub struct {
	clients       map[*Client]bool
	userClients   map[string]*Client
	voiceSessions map[string]*VoiceSession
	broadcast     chan *WSMessage
	registerSync  chan registerRequest
	unregister    chan *Client
	shutdown      chan struct{}
	jwtService    *auth.JWTService
	userRepo      *db.UserRepository
	messageRepo   *db.MessageRepository
	sfu           *sfu.SFU
	sfuCfg        *config.SFUConfig
	screenShare   *sfu.ScreenShareManager
	mu            sync.RWMutex
}

func NewHub(jwtService *auth.JWTService, userRepo *db.UserRepository, messageRepo *db.MessageRepository, sfuCfg *config.SFUConfig) (*Hub, error) {
	h := &Hub{
		clients:       make(map[*Client]bool),
		userClients:   make(map[string]*Client),
		voiceSessions: make(map[string]*VoiceSession),
		broadcast:     make(chan *WSMessage, constants.WSBroadcastBufferSize),
		registerSync:  make(chan registerRequest),
		unregister:    make(chan *Client),
		shutdown:      make(chan struct{}),
		jwtService:    jwtService,
		userRepo:      userRepo,
		messageRepo:   messageRepo,
		sfuCfg:        sfuCfg,
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
	watchdogTicker := time.NewTicker(voiceJoinWatchdogInterval)
	defer watchdogTicker.Stop()

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
			shouldBroadcastOnline := false
			var replacedUserID string
			if req.client.user != nil {
				replacedUserID = req.client.user.ID
				if old, ok := h.userClients[replacedUserID]; ok && old != req.client {
					// Notify old client before closing so it knows not to retry
					select {
					case old.send <- &WSMessage{Op: OpInvalidSession, Data: InvalidSessionPayload{Resumable: false}}:
					default:
					}
					if _, inVoice := h.removeVoiceSessionLocked(replacedUserID); inVoice {
						wasInVoice = true
					}
					old.Close()
					delete(h.clients, old)
				} else {
					shouldBroadcastOnline = true
				}
				h.userClients[replacedUserID] = req.client
			}
			h.mu.Unlock()

			if wasInVoice {
				h.cleanupVoiceForUser(replacedUserID)
			}

			close(req.done)

			if req.client.user != nil && shouldBroadcastOnline {
				h.broadcastPresenceUpdate(req.client.user.ID, req.client.GetStatus(), req.client)
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
					if _, inVoice := h.removeVoiceSessionLocked(userID); inVoice {
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
				if _, err := h.userRepo.FindByID(client.user.ID); err == nil {
					h.broadcastPresenceUpdate(client.user.ID, "offline", nil)
				} else if !errors.Is(err, db.ErrNotFound) {
					slog.Error("error loading user on disconnect", "component", "hub", "error", err, "user_id", client.user.ID)
				}
			}

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				h.sendToClientLocked(client, message)
			}
			h.mu.RUnlock()

		case <-watchdogTicker.C:
			staleUsers := h.collectStaleJoiningUsers()
			for _, userID := range staleUsers {
				h.forceCleanupVoiceSession(userID)
				h.SendDispatchToUser(userID, EventError, ErrorPayload{
					Code:    ErrCodeVoiceNegotiationTimeout,
					Message: "Voice negotiation timed out",
				})
				slog.Warn("voice join watchdog cleaned stale session", "component", "hub", "user_id", userID, "timeout", voiceJoinWatchdogTimeout)
			}
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

func (h *Hub) Broadcast(msg *WSMessage) {
	h.broadcast <- msg
}

// BroadcastDispatch sends a DISPATCH message to all clients.
func (h *Hub) BroadcastDispatch(eventType string, data interface{}) {
	msg := &WSMessage{
		Op:   OpDispatch,
		Type: eventType,
		Data: data,
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
	msg := &WSMessage{
		Op:   OpDispatch,
		Type: eventType,
		Data: data,
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

func (h *Hub) GetMemberSnapshot() []MemberState {
	users, err := h.userRepo.FindAll()
	if err != nil {
		slog.Error("error building member snapshot", "component", "hub", "error", err)
		return []MemberState{}
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	members := make([]MemberState, 0, len(users))
	for _, user := range users {
		status := "offline"
		if client, ok := h.userClients[user.ID]; ok && client.IsIdentified() {
			status = client.GetStatus()
		}

		inVoice := false
		muted := false
		deafened := false
		if session, ok := h.voiceSessions[user.ID]; ok {
			if session.State == VoiceLifecycleJoining || session.State == VoiceLifecycleActive {
				inVoice = true
				muted = session.Muted
				deafened = session.Deafened
			}
		}

		streaming := false
		if h.screenShare != nil {
			streaming = h.screenShare.IsStreaming(user.ID)
		}

		members = append(members, MemberState{
			ID:        user.ID,
			Username:  user.Username,
			Avatar:    user.GetAvatarURL(),
			Status:    status,
			InVoice:   inVoice,
			Muted:     muted,
			Deafened:  deafened,
			Streaming: streaming,
			CreatedAt: user.CreatedAt,
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
	msg := &WSMessage{
		Op:   OpDispatch,
		Type: EventPresenceUpdate,
		Data: PresenceUpdatePayload{
			UserID: userID,
			Status: status,
		},
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

func (h *Hub) BeginVoiceJoin(userID string, muted, deafened bool) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	from := VoiceLifecycleNotInVoice
	if session, ok := h.voiceSessions[userID]; ok {
		from = session.State
	}
	if !isValidVoiceTransition(from, VoiceLifecycleJoining) {
		return fmt.Errorf("voice state transition %s -> %s is invalid", from, VoiceLifecycleJoining)
	}

	h.voiceSessions[userID] = &VoiceSession{
		State:    VoiceLifecycleJoining,
		Muted:    muted,
		Deafened: deafened,
		JoinedAt: time.Now(),
	}
	return nil
}

func (h *Hub) ActivateVoiceSession(userID string) (*VoiceState, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	session, ok := h.voiceSessions[userID]
	if !ok {
		return nil, fmt.Errorf("voice state transition %s -> %s is invalid", VoiceLifecycleNotInVoice, VoiceLifecycleActive)
	}
	if session.State == VoiceLifecycleActive {
		return &VoiceState{Muted: session.Muted, Deafened: session.Deafened}, nil
	}
	if !isValidVoiceTransition(session.State, VoiceLifecycleActive) {
		return nil, fmt.Errorf("voice state transition %s -> %s is invalid", session.State, VoiceLifecycleActive)
	}

	session.State = VoiceLifecycleActive
	return &VoiceState{Muted: session.Muted, Deafened: session.Deafened}, nil
}

func (h *Hub) RemoveUserFromVoice(userID string) (*VoiceSession, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()

	session, ok := h.voiceSessions[userID]
	if !ok {
		return nil, false
	}
	if !isValidVoiceTransition(session.State, VoiceLifecycleLeaving) {
		return nil, false
	}
	session.State = VoiceLifecycleLeaving
	if !isValidVoiceTransition(session.State, VoiceLifecycleNotInVoice) {
		return nil, false
	}

	snapshot := *session
	delete(h.voiceSessions, userID)
	return &snapshot, true
}

func (h *Hub) DiscardVoiceSession(userID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.removeVoiceSessionLocked(userID)
}

func (h *Hub) GetVoiceLifecycleState(userID string) VoiceLifecycleState {
	h.mu.RLock()
	defer h.mu.RUnlock()

	session, ok := h.voiceSessions[userID]
	if !ok {
		return VoiceLifecycleNotInVoice
	}
	return session.State
}

func (h *Hub) GetUserVoiceState(userID string) *VoiceState {
	h.mu.RLock()
	defer h.mu.RUnlock()

	session, ok := h.voiceSessions[userID]
	if !ok {
		return nil
	}

	return &VoiceState{Muted: session.Muted, Deafened: session.Deafened}
}

// UpdateUserVoiceState atomically updates a user's voice state fields.
// Only updates fields that are non-nil. Returns the updated state, or nil if user not in voice.
func (h *Hub) UpdateUserVoiceState(userID string, muted, deafened *bool) *VoiceState {
	h.mu.Lock()
	defer h.mu.Unlock()

	session, exists := h.voiceSessions[userID]
	if !exists || session.State != VoiceLifecycleActive {
		return nil
	}

	if muted != nil {
		session.Muted = *muted
	}
	if deafened != nil {
		session.Deafened = *deafened
	}

	return &VoiceState{Muted: session.Muted, Deafened: session.Deafened}
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
		// Fatal SFU errors should force voice cleanup to avoid ghost state.
		h.forceCleanupVoiceSession(userID)
		h.SendDispatchToUser(userID, EventError, ErrorPayload{
			Code:    ErrCodeVoiceNegotiationFailed,
			Message: "Voice negotiation failed",
		})
	}
}

// handleSfuSignaling is called by the SFU when it needs to send signaling messages
func (h *Hub) handleSfuSignaling(userID string, eventType string, payload interface{}) {
	msg := &WSMessage{
		Op:   OpDispatch,
		Type: eventType,
		Data: payload,
	}
	h.SendToUser(userID, msg)
}

// SendDispatchToUser sends a DISPATCH message to a specific user
func (h *Hub) SendDispatchToUser(userID string, eventType string, payload interface{}) {
	msg := &WSMessage{
		Op:   OpDispatch,
		Type: eventType,
		Data: payload,
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
	_, ok := h.voiceSessions[userID]
	return ok
}

func (h *Hub) removeVoiceSessionLocked(userID string) (*VoiceSession, bool) {
	session, ok := h.voiceSessions[userID]
	if !ok {
		return nil, false
	}
	delete(h.voiceSessions, userID)
	copy := *session
	return &copy, true
}

func (h *Hub) collectStaleJoiningUsers() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()

	now := time.Now()
	staleUsers := make([]string, 0)
	for userID, session := range h.voiceSessions {
		if session.State != VoiceLifecycleJoining {
			continue
		}
		if now.Sub(session.JoinedAt) >= voiceJoinWatchdogTimeout {
			staleUsers = append(staleUsers, userID)
		}
	}

	return staleUsers
}

func (h *Hub) forceCleanupVoiceSession(userID string) {
	h.mu.Lock()
	_, hadSession := h.removeVoiceSessionLocked(userID)
	h.mu.Unlock()

	if h.sfu != nil {
		h.sfu.RemovePeer(userID)
	}
	if h.screenShare != nil {
		h.screenShare.OnUserDisconnect(userID)
	}

	if !hadSession {
		return
	}

	h.BroadcastDispatch(EventVoiceStateUpdate, VoiceStateUpdatePayload{
		UserID:   userID,
		InVoice:  false,
		Muted:    false,
		Deafened: false,
	})
}
