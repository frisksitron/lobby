package ws

import (
	"encoding/json"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"lobby/internal/constants"
	"lobby/internal/models"
	"lobby/internal/sfu"
)

// ClientState represents the lifecycle state of a WebSocket client
type ClientState int32

const (
	ClientStateConnected  ClientState = iota // WS connected, awaiting IDENTIFY
	ClientStateIdentified                    // Authenticated, processing commands
	ClientStateClosing                       // Shutdown initiated
	ClientStateClosed                        // Terminal
)

const (
	// Time allowed to write a message to the peer
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer
	pongWait = 15 * time.Second

	// Send pings to peer with this period. Must be less than pongWait
	pingPeriod = 10 * time.Second

	// Maximum message size allowed from peer (increased for video SDP)
	maxMessageSize = 65536

	// Timeout for hub registration
	registerTimeout = 5 * time.Second

	// Rate limiting intervals
	messageRateLimit = 200 * time.Millisecond // 5 messages per second

	// Voice join cooldown: 3 joins in 15s triggers a 15s cooldown
	voiceJoinLimit    = 3
	voiceJoinWindow   = 15 * time.Second
	voiceJoinCooldown = 15 * time.Second

	// Maximum message content length in characters
	maxMessageContentLength = 4000

	// Mute/deafen cooldown: 5 toggles in 5s triggers a 10s cooldown
	voiceToggleLimit = 5
	voiceToggleWindow     = 5 * time.Second
	voiceCooldownDuration = 10 * time.Second
)

// Client represents a single WebSocket connection
type Client struct {
	hub           *Hub
	conn          *websocket.Conn
	send          chan *WSMessage
	connCloseOnce sync.Once

	// Lifecycle state (replaces: closeOnce, done, identified)
	state atomic.Int32

	// User info (populated after IDENTIFY)
	user      *models.User
	mu        sync.RWMutex // Protects status
	status    string       // online, idle, dnd, offline
	sessionID string       // Unique session identifier

	// DroppedMessages tracks how many messages have been dropped due to full buffer
	DroppedMessages int64

	// Rate limiting state — only accessed from the ReadPump goroutine (via handleMessage),
	// so no mutex is needed.
	lastMessage         time.Time
	voiceJoins          []time.Time // timestamps of recent voice joins
	voiceJoinCooldownAt time.Time   // when join cooldown expires
	voiceToggles        []time.Time // timestamps of recent mute/deafen toggles
	voiceCooldownAt     time.Time   // when mute/deafen cooldown expires
}

// NewClient creates a new client
func NewClient(hub *Hub, conn *websocket.Conn) *Client {
	c := &Client{
		hub:    hub,
		conn:   conn,
		send:   make(chan *WSMessage, constants.WSClientSendBufferSize),
		status: "online",
	}
	c.state.Store(int32(ClientStateConnected))
	return c
}

// Close performs cleanup for the client, ensuring it only happens once
func (c *Client) Close() {
	if !c.transitionTo(ClientStateClosing) {
		// Already closing/closed, but still ensure conn is closed
		c.connCloseOnce.Do(func() { c.conn.Close() })
		return
	}
	c.connCloseOnce.Do(func() { c.conn.Close() })
	c.transitionTo(ClientStateClosed)
}

func (c *Client) ReadPump() {
	defer func() {
		c.hub.unregister <- c
		c.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("Error parsing message: %v", err)
			continue
		}

		c.handleMessage(&msg)
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			if c.IsClosed() {
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.conn.WriteJSON(message); err != nil {
				log.Printf("Error writing message: %v", err)
				return
			}

		case <-ticker.C:
			if c.IsClosed() {
				return
			}

			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// getUserID returns the user ID or "unknown" if not set
func (c *Client) getUserID() string {
	if c.user != nil {
		return c.user.ID
	}
	return "unknown"
}

// SendHello sends the HELLO message to initiate the connection
func (c *Client) SendHello() {
	c.send <- &WSMessage{
		Op:   OpHello,
		Data: HelloPayload{},
	}
}

func (c *Client) handleMessage(msg *WSMessage) {
	switch msg.Op {
	case OpDispatch:
		c.handleDispatch(msg)
	default:
		log.Printf("Unknown op code: %d", msg.Op)
	}
}

// handleDispatch routes DISPATCH messages by their type
func (c *Client) handleDispatch(msg *WSMessage) {
	switch msg.Type {
	case CmdIdentify:
		c.handleIdentify(msg)
	case CmdMessageSend:
		c.handleMessageSend(msg)
	case CmdPresenceSet:
		c.handlePresenceSet(msg)
	case CmdTyping:
		c.handleTyping()
	case CmdVoiceJoin:
		c.handleVoiceJoin(msg)
	case CmdVoiceLeave:
		c.handleVoiceLeave()
	case CmdRtcOffer:
		c.handleRtcOffer(msg)
	case CmdRtcAnswer:
		c.handleRtcAnswer(msg)
	case CmdRtcIceCandidate:
		c.handleRtcIceCandidate(msg)
	case CmdVoiceStateSet:
		c.handleVoiceStateSet(msg)
	case CmdScreenShareStart:
		c.handleScreenShareStart()
	case CmdScreenShareStop:
		c.handleScreenShareStop()
	case CmdScreenShareSubscribe:
		c.handleScreenShareSubscribe(msg)
	case CmdScreenShareUnsubscribe:
		c.handleScreenShareUnsubscribe()
	default:
		log.Printf("Unknown dispatch type: %s", msg.Type)
	}
}

func (c *Client) handleIdentify(msg *WSMessage) {
	if c.State() != ClientStateConnected {
		return
	}

	data, _ := msg.Data.(map[string]interface{})

	// Extract and validate token from IDENTIFY payload
	token, _ := data["token"].(string)
	if token == "" {
		log.Printf("IDENTIFY missing token")
		c.send <- &WSMessage{Op: OpDispatch, Type: EventError, Data: ErrorPayload{Code: "AUTH_FAILED", Message: "Missing token"}}
		c.Close()
		return
	}

	claims, err := c.hub.jwtService.ValidateAccessToken(token)
	if err != nil {
		log.Printf("IDENTIFY invalid token: %v", err)
		c.send <- &WSMessage{Op: OpDispatch, Type: EventError, Data: ErrorPayload{Code: "AUTH_FAILED", Message: "Invalid token"}}
		c.Close()
		return
	}

	user, err := c.hub.userRepo.FindByID(claims.UserID)
	if err != nil {
		log.Printf("IDENTIFY user not found: %v", err)
		c.send <- &WSMessage{Op: OpDispatch, Type: EventError, Data: ErrorPayload{Code: "AUTH_FAILED", Message: "User not found"}}
		c.Close()
		return
	}

	c.SetUser(user)

	// Transition to identified state
	if !c.transitionTo(ClientStateIdentified) {
		return // Race: already transitioned
	}
	c.sessionID = uuid.New().String()

	if presence, ok := data["presence"].(map[string]interface{}); ok {
		if status, ok := presence["status"].(string); ok {
			switch status {
			case "online", "idle", "dnd":
				c.SetStatus(status)
			}
		}
	}

	// Register synchronously to ensure client is in members list before READY
	done := make(chan struct{})
	select {
	case c.hub.registerSync <- registerRequest{client: c, done: done}:
		select {
		case <-done:
			// Registration successful
		case <-time.After(registerTimeout):
			log.Printf("Registration timeout for client %s", c.user.ID)
			return
		}
	case <-time.After(registerTimeout):
		log.Printf("Registration send timeout for client %s", c.user.ID)
		return
	}

	c.send <- &WSMessage{
		Op: OpReady,
		Data: ReadyPayload{
			SessionID: c.sessionID,
			User:      c.user,
			Members:   c.hub.GetOnlineMembers(),
		},
	}

	log.Printf("Client identified: %s (session: %s)", c.user.ID, c.sessionID)
}

func (c *Client) handleMessageSend(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	data, ok := msg.Data.(map[string]interface{})
	if !ok {
		return
	}

	content, ok := data["content"].(string)
	if !ok || content == "" {
		return
	}

	nonce, _ := data["nonce"].(string)

	if len(content) > maxMessageContentLength {
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:    "MESSAGE_TOO_LONG",
				Message: "Message exceeds maximum length",
				Nonce:   nonce,
			},
		}
		return
	}

	// Rate limit check
	now := time.Now()
	if now.Sub(c.lastMessage) < messageRateLimit {
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:    "RATE_LIMITED",
				Message: "Sending too fast",
				Nonce:   nonce,
			},
		}
		return
	}
	c.lastMessage = now

	c.hub.BroadcastDispatchExcept(EventTypingStop, TypingStopPayload{
		UserID: c.user.ID,
	}, c)

	message, err := c.hub.MessageRepo().Create(c.user.ID, content)
	if err != nil {
		log.Printf("Error creating message: %v", err)
		return
	}

	c.hub.BroadcastDispatch(EventMessageCreate, MessageCreatePayload{
		ID: message.ID,
		Author: &MessageAuthor{
			ID:       c.user.ID,
			Username: c.user.Username,
			Avatar:   c.user.GetAvatarURL(),
		},
		Content:   message.Content,
		CreatedAt: message.CreatedAt.UTC().Format(time.RFC3339Nano),
		Nonce:     nonce,
	})
}

func (c *Client) handlePresenceSet(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	data, ok := msg.Data.(map[string]interface{})
	if !ok {
		return
	}

	status, ok := data["status"].(string)
	if !ok {
		return
	}

	switch status {
	case "online", "idle", "dnd", "offline":
		c.SetStatus(status)
	default:
		return
	}

	c.hub.BroadcastDispatch(EventPresenceUpdate, PresenceUpdatePayload{
		UserID: c.user.ID,
		Status: c.GetStatus(),
	})
}

func (c *Client) handleTyping() {
	if !c.IsIdentified() {
		return
	}

	c.hub.BroadcastDispatchExcept(EventTypingStart, TypingStartPayload{
		UserID:    c.user.ID,
		Username:  c.user.Username,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
	}, c)
}

// SetUser sets the authenticated user for this client
func (c *Client) SetUser(user *models.User) {
	c.user = user
}

// GetStatus returns the client's current presence status
func (c *Client) GetStatus() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.status
}

// SetStatus sets the client's presence status
func (c *Client) SetStatus(status string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.status = status
}

// State returns the current client state
func (c *Client) State() ClientState {
	return ClientState(c.state.Load())
}

// IsIdentified returns true if the client is in the identified state
func (c *Client) IsIdentified() bool {
	return c.State() == ClientStateIdentified
}

// IsClosed returns true if the client is closing or closed
func (c *Client) IsClosed() bool {
	state := c.State()
	return state == ClientStateClosing || state == ClientStateClosed
}

// isValidClientTransition checks if a state transition is valid
func isValidClientTransition(from, to ClientState) bool {
	switch from {
	case ClientStateConnected:
		return to == ClientStateIdentified || to == ClientStateClosing
	case ClientStateIdentified:
		return to == ClientStateClosing
	case ClientStateClosing:
		return to == ClientStateClosed
	case ClientStateClosed:
		return false
	}
	return false
}

// transitionTo atomically transitions to a new state if valid
func (c *Client) transitionTo(newState ClientState) bool {
	for {
		current := ClientState(c.state.Load())
		if !isValidClientTransition(current, newState) {
			return false
		}
		if c.state.CompareAndSwap(int32(current), int32(newState)) {
			return true
		}
	}
}

// CloseSend closes the send channel (called by hub during cleanup)
func (c *Client) CloseSend() {
	if c.transitionTo(ClientStateClosing) {
		close(c.send)
		c.connCloseOnce.Do(func() { c.conn.Close() })
		c.transitionTo(ClientStateClosed)
	}
}

func (c *Client) handleVoiceJoin(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	now := time.Now()

	// Check if in join cooldown
	if now.Before(c.voiceJoinCooldownAt) {
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:       "VOICE_JOIN_COOLDOWN",
				Message:    "Joining too fast, slow down",
				RetryAfter: c.voiceJoinCooldownAt.UnixMilli(),
			},
		}
		return
	}

	// Record join and prune old entries
	cutoff := now.Add(-voiceJoinWindow)
	filtered := c.voiceJoins[:0]
	for _, t := range c.voiceJoins {
		if t.After(cutoff) {
			filtered = append(filtered, t)
		}
	}
	filtered = append(filtered, now)
	c.voiceJoins = filtered

	// Check if threshold exceeded
	if len(c.voiceJoins) >= voiceJoinLimit {
		c.voiceJoinCooldownAt = now.Add(voiceJoinCooldown)
		c.voiceJoins = c.voiceJoins[:0]
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:       "VOICE_JOIN_COOLDOWN",
				Message:    "Joining too fast, slow down",
				RetryAfter: c.voiceJoinCooldownAt.UnixMilli(),
			},
		}
		return
	}

	muted := false
	deafened := false
	if data, ok := msg.Data.(map[string]interface{}); ok {
		if m, ok := data["muted"].(bool); ok {
			muted = m
		}
		if d, ok := data["deafened"].(bool); ok {
			deafened = d
		}
	}

	sfuInst := c.hub.GetSFU()
	if sfuInst != nil {
		_, err := sfuInst.AddPeer(c.user.ID)
		if err != nil {
			log.Printf("Error creating SFU peer for %s: %v", c.user.ID, err)
			c.send <- &WSMessage{
				Op:   OpDispatch,
				Type: EventError,
				Data: ErrorPayload{
					Code:    "VOICE_JOIN_FAILED",
					Message: "Failed to join voice",
				},
			}
			return
		}
	}

	c.hub.SetUserVoiceState(c.user.ID, &VoiceState{
		Muted:    muted,
		Deafened: deafened,
	})

	participants := c.hub.GetVoiceParticipantIDs(c.user.ID)

	iceServers := []ICEServerInfo{}
	if cfg := c.hub.GetSFUConfig(); cfg != nil {
		for _, s := range sfu.BuildICEServers(cfg.TURN, c.user.ID) {
			iceServers = append(iceServers, ICEServerInfo{
				URLs:       s.URLs,
				Username:   s.Username,
				Credential: s.Credential,
			})
		}
	}

	// Send RTC_READY first so client can set up signaling listeners
	c.hub.SendDispatchToUser(c.user.ID, EventRtcReady, RtcReadyPayload{
		Participants: participants,
		ICEServers:   iceServers,
	})

	// Then send initial offer - client's listeners are now ready
	// Server initiates offers to ensure it's always the ICE controlling agent
	if sfuInst != nil {
		if err := sfuInst.SendInitialOffer(c.user.ID); err != nil {
			log.Printf("Error sending initial offer to %s: %v", c.user.ID, err)
		}
	}

	c.hub.BroadcastDispatch(EventVoiceStateUpdate, VoiceStateUpdatePayload{
		UserID:   c.user.ID,
		InVoice:  true,
		Muted:    muted,
		Deafened: deafened,
	})

	log.Printf("User %s joined voice (muted: %v, deafened: %v)", c.user.ID, muted, deafened)
}

func (c *Client) handleVoiceLeave() {
	if !c.IsIdentified() {
		return
	}

	if c.hub.GetUserVoiceState(c.user.ID) == nil {
		return
	}

	// Stop screen share if active
	sm := c.hub.GetScreenShareManager()
	if sm != nil {
		sm.StopShare(c.user.ID)
		sm.Unsubscribe(c.user.ID)
	}

	c.hub.RemoveUserFromVoice(c.user.ID)

	sfuInst := c.hub.GetSFU()
	if sfuInst != nil {
		sfuInst.RemovePeer(c.user.ID)
	}

	c.hub.BroadcastDispatch(EventVoiceStateUpdate, VoiceStateUpdatePayload{
		UserID:   c.user.ID,
		InVoice:  false,
		Muted:    false,
		Deafened: false,
	})

	log.Printf("User %s left voice", c.user.ID)
}

func (c *Client) handleRtcOffer(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	data, ok := msg.Data.(map[string]interface{})
	if !ok {
		log.Printf("Invalid RTC_OFFER payload from %s", c.user.ID)
		return
	}

	sdp, ok := data["sdp"].(string)
	if !ok || sdp == "" {
		log.Printf("Missing SDP in RTC_OFFER from %s", c.user.ID)
		return
	}

	answerSDP, err := c.hub.HandleRtcOffer(c.user.ID, sdp)
	if err != nil {
		log.Printf("Error handling RTC offer from %s: %v", c.user.ID, err)
		return
	}

	// Empty answer means offer was ignored (e.g., offer collision - server is impolite peer)
	if answerSDP == "" {
		return
	}

	c.hub.SendDispatchToUser(c.user.ID, EventRtcAnswer, RtcAnswerPayload{
		SDP: answerSDP,
	})

	log.Printf("Processed RTC offer from %s", c.user.ID)
}

func (c *Client) handleRtcAnswer(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	data, ok := msg.Data.(map[string]interface{})
	if !ok {
		log.Printf("Invalid RTC_ANSWER payload from %s", c.user.ID)
		return
	}

	sdp, ok := data["sdp"].(string)
	if !ok || sdp == "" {
		log.Printf("Missing SDP in RTC_ANSWER from %s", c.user.ID)
		return
	}

	if err := c.hub.HandleRtcAnswer(c.user.ID, sdp); err != nil {
		log.Printf("Error handling RTC answer from %s: %v", c.user.ID, err)
		return
	}

	log.Printf("Processed RTC answer from %s", c.user.ID)
}

func (c *Client) handleRtcIceCandidate(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	data, ok := msg.Data.(map[string]interface{})
	if !ok {
		log.Printf("Invalid RTC_ICE_CANDIDATE payload from %s", c.user.ID)
		return
	}

	candidate, ok := data["candidate"].(string)
	if !ok {
		log.Printf("Missing candidate in RTC_ICE_CANDIDATE from %s", c.user.ID)
		return
	}

	var sdpMid *string
	var sdpMLineIndex *uint16
	if mid, ok := data["sdpMid"].(string); ok {
		sdpMid = &mid
	}
	if idx, ok := data["sdpMLineIndex"].(float64); ok {
		i := uint16(idx)
		sdpMLineIndex = &i
	}

	if err := c.hub.HandleRtcIceCandidate(c.user.ID, candidate, sdpMid, sdpMLineIndex); err != nil {
		log.Printf("Error handling ICE candidate from %s: %v", c.user.ID, err)
		return
	}
}

func (c *Client) handleVoiceStateSet(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	data, ok := msg.Data.(map[string]interface{})
	if !ok {
		return
	}

	// Speaking: broadcast directly with no rate limit
	if speaking, ok := data["speaking"].(bool); ok {
		c.hub.BroadcastDispatch(EventVoiceSpeaking, VoiceSpeakingPayload{
			UserID:   c.user.ID,
			Speaking: speaking,
		})
	}

	// Mute/deafen changes
	var muted, deafened *bool
	if m, ok := data["muted"].(bool); ok {
		muted = &m
	}
	if d, ok := data["deafened"].(bool); ok {
		deafened = &d
	}

	if muted == nil && deafened == nil {
		return
	}

	// Determine if this involves an unmute or undeafen transition
	currentState := c.hub.GetUserVoiceState(c.user.ID)
	isUnmuting := muted != nil && !*muted && currentState != nil && currentState.Muted
	isUndeafening := deafened != nil && !*deafened && currentState != nil && currentState.Deafened

	// Only rate-limit unmute/undeafen; muting/deafening always goes through
	if isUnmuting || isUndeafening {
		now := time.Now()

		// Check if currently in cooldown
		if now.Before(c.voiceCooldownAt) {
			c.send <- &WSMessage{
				Op:   OpDispatch,
				Type: EventError,
				Data: ErrorPayload{
					Code:       "VOICE_STATE_COOLDOWN",
					Message:    "Too many toggles, try again in a moment",
					RetryAfter: c.voiceCooldownAt.UnixMilli(),
				},
			}
			return
		}

		// Record this toggle and prune old entries outside the window
		cutoff := now.Add(-voiceToggleWindow)
		filtered := c.voiceToggles[:0]
		for _, t := range c.voiceToggles {
			if t.After(cutoff) {
				filtered = append(filtered, t)
			}
		}
		filtered = append(filtered, now)
		c.voiceToggles = filtered

		// Check if threshold exceeded
		if len(c.voiceToggles) >= voiceToggleLimit {
			c.voiceCooldownAt = now.Add(voiceCooldownDuration)
			c.voiceToggles = c.voiceToggles[:0]
			c.send <- &WSMessage{
				Op:   OpDispatch,
				Type: EventError,
				Data: ErrorPayload{
					Code:       "VOICE_STATE_COOLDOWN",
					Message:    "Too many toggles, try again in a moment",
					RetryAfter: c.voiceCooldownAt.UnixMilli(),
				},
			}
			return
		}
	}

	// Process the state change
	newState := c.hub.UpdateUserVoiceState(c.user.ID, muted, deafened)
	if newState != nil {
		c.hub.BroadcastDispatch(EventVoiceStateUpdate, VoiceStateUpdatePayload{
			UserID:   c.user.ID,
			InVoice:  true,
			Muted:    newState.Muted,
			Deafened: newState.Deafened,
		})
	}
}

func (c *Client) handleScreenShareStart() {
	if !c.IsIdentified() {
		return
	}

	// User must be in voice to screen share
	if c.hub.GetUserVoiceState(c.user.ID) == nil {
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:    "NOT_IN_VOICE",
				Message: "Must be in voice to screen share",
			},
		}
		return
	}

	sm := c.hub.GetScreenShareManager()
	if sm == nil {
		return
	}

	// Register as sharing, then trigger server renegotiation so the client
	// can change video direction to sendrecv and attach the track
	sm.StartShare(c.user.ID)

	sfuInst := c.hub.GetSFU()
	if sfuInst != nil {
		sfuInst.TriggerRenegotiation(c.user.ID)
	}
	log.Printf("User %s requested screen share, triggered renegotiation", c.user.ID)
}

func (c *Client) handleScreenShareStop() {
	if !c.IsIdentified() {
		return
	}

	sm := c.hub.GetScreenShareManager()
	if sm == nil {
		return
	}

	sm.StopShare(c.user.ID)
	log.Printf("User %s stopped screen share", c.user.ID)
}

func (c *Client) handleScreenShareSubscribe(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	data, ok := msg.Data.(map[string]interface{})
	if !ok {
		return
	}

	streamerID, ok := data["streamer_id"].(string)
	if !ok || streamerID == "" {
		return
	}

	sm := c.hub.GetScreenShareManager()
	if sm == nil {
		return
	}

	if err := sm.Subscribe(c.user.ID, streamerID); err != nil {
		log.Printf("Error subscribing to screen share: %v", err)
	}
}

func (c *Client) handleScreenShareUnsubscribe() {
	if !c.IsIdentified() {
		return
	}

	sm := c.hub.GetScreenShareManager()
	if sm == nil {
		return
	}

	sm.Unsubscribe(c.user.ID)
}

