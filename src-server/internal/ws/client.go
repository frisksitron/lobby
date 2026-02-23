package ws

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/microcosm-cc/bluemonday"

	"lobby/internal/constants"
	"lobby/internal/db"
	sqldb "lobby/internal/db/sqlc"
	"lobby/internal/mediaurl"
	"lobby/internal/models"
	"lobby/internal/sfu"
)

// htmlPolicy is a concurrency-safe bluemonday policy for sanitizing message HTML.
var htmlPolicy = func() *bluemonday.Policy {
	p := bluemonday.NewPolicy()
	p.AllowElements(
		"p", "br", "strong", "b", "em", "i", "s", "del",
		"code", "pre", "a", "ul", "ol", "li", "blockquote",
		"h1", "h2", "h3", "h4", "h5", "h6", "hr",
	)
	p.AllowAttrs("href", "rel").OnElements("a")
	p.AllowURLSchemes("http", "https", "mailto")
	p.RequireNoFollowOnLinks(true)
	p.AddTargetBlankToFullyQualifiedLinks(true)
	return p
}()

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

	// Maximum message content length in characters (includes HTML markup)
	maxMessageContentLength = 8000

	// Mute/deafen cooldown: 5 toggles in 5s triggers a 10s cooldown
	voiceToggleLimit      = 5
	voiceToggleWindow     = 5 * time.Second
	voiceCooldownDuration = 10 * time.Second

	// Signaling command budgets
	rtcSignalingLimit  = 300
	rtcSignalingWindow = 10 * time.Second

	screenShareSignalingLimit  = 40
	screenShareSignalingWindow = 10 * time.Second
)

// Client represents a single WebSocket connection
type Client struct {
	hub           *Hub
	conn          *websocket.Conn
	send          chan *WSMessage
	connCloseOnce sync.Once
	sendCloseOnce sync.Once
	authExpiryMu  sync.Mutex
	authExpiry    *time.Timer
	authExpiryVer uint64

	callbackMu              sync.Mutex
	identifiedCallbacks     []func(*Client)
	closeCallbacks          []func(*Client)
	identifiedCallbacksOnce sync.Once
	closeCallbacksOnce      sync.Once

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

	rtcSignals         []time.Time // timestamps of recent RTC signaling commands
	screenShareSignals []time.Time // timestamps of recent screen-share signaling commands
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

func (c *Client) OnIdentified(callback func(*Client)) {
	if callback == nil {
		return
	}
	if c.IsIdentified() {
		callback(c)
		return
	}
	c.callbackMu.Lock()
	c.identifiedCallbacks = append(c.identifiedCallbacks, callback)
	c.callbackMu.Unlock()
}

func (c *Client) OnClose(callback func(*Client)) {
	if callback == nil {
		return
	}
	if c.IsClosed() {
		callback(c)
		return
	}
	c.callbackMu.Lock()
	c.closeCallbacks = append(c.closeCallbacks, callback)
	c.callbackMu.Unlock()
}

func (c *Client) runIdentifiedCallbacks() {
	c.identifiedCallbacksOnce.Do(func() {
		c.callbackMu.Lock()
		callbacks := append([]func(*Client){}, c.identifiedCallbacks...)
		c.identifiedCallbacks = nil
		c.callbackMu.Unlock()
		for _, callback := range callbacks {
			callback(c)
		}
	})
}

func (c *Client) runCloseCallbacks() {
	c.closeCallbacksOnce.Do(func() {
		c.callbackMu.Lock()
		callbacks := append([]func(*Client){}, c.closeCallbacks...)
		c.closeCallbacks = nil
		c.callbackMu.Unlock()
		for _, callback := range callbacks {
			callback(c)
		}
	})
}

// Close performs cleanup for the client, ensuring it only happens once
func (c *Client) Close() {
	c.stopAuthExpiryTimer()

	if !c.transitionTo(ClientStateClosing) {
		// Already closing/closed, but still ensure conn is closed
		c.connCloseOnce.Do(func() { c.conn.Close() })
		return
	}
	c.runCloseCallbacks()
	c.connCloseOnce.Do(func() { c.conn.Close() })
	c.transitionTo(ClientStateClosed)
}

func (c *Client) stopAuthExpiryTimer() {
	c.authExpiryMu.Lock()
	defer c.authExpiryMu.Unlock()
	c.authExpiryVer++

	if c.authExpiry != nil {
		c.authExpiry.Stop()
		c.authExpiry = nil
	}
}

func (c *Client) scheduleAuthExpiry(expiresAt time.Time) {
	c.authExpiryMu.Lock()
	defer c.authExpiryMu.Unlock()

	c.authExpiryVer++
	version := c.authExpiryVer

	if c.authExpiry != nil {
		c.authExpiry.Stop()
		c.authExpiry = nil
	}

	delay := time.Until(expiresAt)
	if delay <= 0 {
		go c.handleAuthExpired(version)
		return
	}

	c.authExpiry = time.AfterFunc(delay, func() {
		c.handleAuthExpired(version)
	})
}

func (c *Client) handleAuthExpired(version uint64) {
	c.authExpiryMu.Lock()
	if version != c.authExpiryVer {
		c.authExpiryMu.Unlock()
		return
	}
	c.authExpiry = nil
	c.authExpiryMu.Unlock()

	if !c.IsIdentified() || c.IsClosed() || c.user == nil {
		return
	}

	if active := c.hub.GetClient(c.user.ID); active != c {
		return
	}

	c.trySend(&WSMessage{
		Op:   OpDispatch,
		Type: EventError,
		Data: ErrorPayload{
			Code:    ErrCodeAuthExpired,
			Message: "Access token expired",
		},
	})

	c.Close()
}

func (c *Client) trySend(msg *WSMessage) bool {
	if c.IsClosed() {
		return false
	}

	defer func() {
		if r := recover(); r != nil {
			slog.Debug("attempted to send on closed channel", "component", "ws", "user_id", c.getUserID())
		}
	}()

	select {
	case c.send <- msg:
		return true
	default:
		return false
	}
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
				slog.Error("websocket error", "component", "ws", "error", err)
			}
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			slog.Warn("error parsing message", "component", "ws", "error", err)
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
				slog.Error("error writing message", "component", "ws", "error", err)
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
		slog.Warn("unknown op code", "component", "ws", "op", msg.Op)
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
		if !c.allowRTCSignaling(msg.Type) {
			return
		}
		c.handleRtcOffer(msg)
	case CmdRtcAnswer:
		if !c.allowRTCSignaling(msg.Type) {
			return
		}
		c.handleRtcAnswer(msg)
	case CmdRtcIceCandidate:
		if !c.allowRTCSignaling(msg.Type) {
			return
		}
		c.handleRtcIceCandidate(msg)
	case CmdVoiceStateSet:
		c.handleVoiceStateSet(msg)
	case CmdScreenShareStart:
		if !c.allowScreenShareSignaling(msg.Type) {
			return
		}
		c.handleScreenShareStart()
	case CmdScreenShareStop:
		if !c.allowScreenShareSignaling(msg.Type) {
			return
		}
		c.handleScreenShareStop()
	case CmdScreenShareSubscribe:
		if !c.allowScreenShareSignaling(msg.Type) {
			return
		}
		c.handleScreenShareSubscribe(msg)
	case CmdScreenShareUnsubscribe:
		if !c.allowScreenShareSignaling(msg.Type) {
			return
		}
		c.handleScreenShareUnsubscribe()
	default:
		slog.Warn("unknown dispatch type", "component", "ws", "type", msg.Type)
	}
}

func (c *Client) decodeDispatchData(msg *WSMessage, target interface{}) bool {
	raw, err := json.Marshal(msg.Data)
	if err != nil {
		slog.Warn("failed to encode dispatch payload", "component", "ws", "type", msg.Type, "user_id", c.getUserID(), "error", err)
		return false
	}

	if err := json.Unmarshal(raw, target); err != nil {
		slog.Warn("failed to decode dispatch payload", "component", "ws", "type", msg.Type, "user_id", c.getUserID(), "error", err)
		return false
	}

	return true
}

func (c *Client) allowRTCSignaling(command string) bool {
	ok, retryAfter := c.allowCommandRateLimit(&c.rtcSignals, rtcSignalingLimit, rtcSignalingWindow)
	if ok {
		return true
	}
	c.rejectSignalingRateLimit(command, retryAfter)
	return false
}

func (c *Client) allowScreenShareSignaling(command string) bool {
	ok, retryAfter := c.allowCommandRateLimit(&c.screenShareSignals, screenShareSignalingLimit, screenShareSignalingWindow)
	if ok {
		return true
	}
	c.rejectSignalingRateLimit(command, retryAfter)
	return false
}

func (c *Client) allowCommandRateLimit(times *[]time.Time, limit int, window time.Duration) (bool, int64) {
	now := time.Now()
	cutoff := now.Add(-window)

	filtered := (*times)[:0]
	for _, t := range *times {
		if t.After(cutoff) {
			filtered = append(filtered, t)
		}
	}

	if len(filtered) >= limit {
		retryAfter := filtered[0].Add(window).UnixMilli()
		*times = filtered
		return false, retryAfter
	}

	filtered = append(filtered, now)
	*times = filtered
	return true, 0
}

func (c *Client) rejectSignalingRateLimit(command string, retryAfter int64) {
	c.send <- &WSMessage{
		Op:   OpDispatch,
		Type: EventError,
		Data: ErrorPayload{
			Code:       ErrCodeSignalingRateLimited,
			Message:    "",
			RetryAfter: retryAfter,
		},
	}

	slog.Warn("signaling command rate limited", "component", "ws", "user_id", c.getUserID(), "command", command, "retry_after", retryAfter)
}

func (c *Client) handleIdentify(msg *WSMessage) {
	state := c.State()
	if state != ClientStateConnected && state != ClientStateIdentified {
		return
	}

	var data IdentifyPayload
	if !c.decodeDispatchData(msg, &data) {
		slog.Warn("IDENTIFY invalid payload", "component", "ws", "user_id", c.getUserID())
		c.send <- &WSMessage{Op: OpDispatch, Type: EventError, Data: ErrorPayload{Code: ErrCodeAuthFailed, Message: "Invalid identify payload"}}
		c.Close()
		return
	}

	// Extract and validate token from IDENTIFY payload
	token := data.Token
	if token == "" {
		slog.Warn("IDENTIFY missing token", "component", "ws")
		c.send <- &WSMessage{Op: OpDispatch, Type: EventError, Data: ErrorPayload{Code: ErrCodeAuthFailed, Message: "Missing token"}}
		c.Close()
		return
	}

	claims, err := c.hub.jwtService.ValidateAccessToken(token)
	if err != nil {
		slog.Warn("IDENTIFY invalid token", "component", "ws", "error", err)
		c.send <- &WSMessage{Op: OpDispatch, Type: EventError, Data: ErrorPayload{Code: ErrCodeAuthFailed, Message: "Invalid token"}}
		c.Close()
		return
	}

	if claims.ExpiresAt == nil {
		slog.Warn("IDENTIFY token missing expiry", "component", "ws", "user_id", claims.UserID)
		c.send <- &WSMessage{Op: OpDispatch, Type: EventError, Data: ErrorPayload{Code: ErrCodeAuthFailed, Message: "Token missing expiry"}}
		c.Close()
		return
	}

	expiresAt := claims.ExpiresAt.Time
	if !expiresAt.After(time.Now()) {
		slog.Warn("IDENTIFY token already expired", "component", "ws", "user_id", claims.UserID)
		c.send <- &WSMessage{Op: OpDispatch, Type: EventError, Data: ErrorPayload{Code: ErrCodeAuthExpired, Message: "Access token expired"}}
		c.Close()
		return
	}

	userRow, err := c.hub.queries.GetActiveUserByID(context.Background(), claims.UserID)
	if err != nil {
		slog.Warn("IDENTIFY user not found", "component", "ws", "error", err)
		c.send <- &WSMessage{Op: OpDispatch, Type: EventError, Data: ErrorPayload{Code: ErrCodeAuthFailed, Message: "User not found"}}
		c.Close()
		return
	}
	user := modelUserFromDBUser(userRow)

	if claims.SessionVersion != user.SessionVersion {
		slog.Warn("IDENTIFY token session version mismatch", "component", "ws", "user_id", user.ID)
		c.send <- &WSMessage{Op: OpDispatch, Type: EventError, Data: ErrorPayload{Code: ErrCodeAuthFailed, Message: "Session invalidated"}}
		c.Close()
		return
	}

	if state == ClientStateIdentified {
		if c.user == nil || c.user.ID != user.ID {
			slog.Warn("IDENTIFY attempted user switch", "component", "ws", "current_user_id", c.getUserID(), "token_user_id", user.ID)
			c.send <- &WSMessage{Op: OpDispatch, Type: EventError, Data: ErrorPayload{Code: ErrCodeAuthFailed, Message: "Session invalidated"}}
			c.Close()
			return
		}

		c.SetUser(user)
		c.scheduleAuthExpiry(expiresAt)
		slog.Info("client re-identified", "component", "ws", "user_id", c.user.ID, "session_id", c.sessionID)
		return
	}

	c.SetUser(user)

	// Transition to identified state
	if !c.transitionTo(ClientStateIdentified) {
		return // Race: already transitioned
	}
	c.sessionID = uuid.New().String()
	c.runIdentifiedCallbacks()

	if data.Presence != nil {
		switch data.Presence.Status {
		case "online", "idle", "dnd":
			c.SetStatus(data.Presence.Status)
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
			slog.Error("registration timeout", "component", "ws", "user_id", c.user.ID)
			c.Close()
			return
		}
	case <-time.After(registerTimeout):
		slog.Error("registration send timeout", "component", "ws", "user_id", c.user.ID)
		c.Close()
		return
	}

	c.scheduleAuthExpiry(expiresAt)

	c.send <- &WSMessage{
		Op: OpReady,
		Data: ReadyPayload{
			ProtocolVersion: ProtocolVersion,
			SessionID:       c.sessionID,
			User:            NewReadyUser(c.user),
			Members:         c.hub.GetMemberSnapshot(),
		},
	}

	slog.Info("client identified", "component", "ws", "user_id", c.user.ID, "session_id", c.sessionID)
}

func (c *Client) handleMessageSend(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	var data MessageSendPayload
	if !c.decodeDispatchData(msg, &data) {
		return
	}

	content := data.Content
	attachmentIDs := normalizeAttachmentIDs(data.AttachmentIDs)
	nonce := data.Nonce
	if content == "" && len(attachmentIDs) == 0 {
		return
	}

	if utf8.RuneCountInString(content) > maxMessageContentLength {
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:    ErrCodeMessageTooLong,
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
				Code:    ErrCodeRateLimited,
				Message: "",
				Nonce:   nonce,
			},
		}
		return
	}
	c.lastMessage = now

	c.hub.BroadcastDispatchExcept(EventTypingStop, TypingStopPayload{
		UserID: c.user.ID,
	}, c)

	if content != "" {
		content = htmlPolicy.Sanitize(content)
	}
	if content == "" && len(attachmentIDs) == 0 {
		return
	}

	messageID, err := db.GenerateID("msg")
	if err != nil {
		slog.Error("error generating message id", "component", "ws", "error", err)
		return
	}
	createdAt := time.Now().UTC()

	tx, err := c.hub.database.BeginTx(context.Background(), nil)
	if err != nil {
		slog.Error("error starting message transaction", "component", "ws", "error", err)
		return
	}
	defer tx.Rollback()

	qtx := c.hub.queries.WithTx(tx)

	err = qtx.CreateMessage(context.Background(), sqldb.CreateMessageParams{
		ID:        messageID,
		AuthorID:  c.user.ID,
		Content:   content,
		CreatedAt: createdAt,
	})
	if err != nil {
		slog.Error("error creating message", "component", "ws", "error", err)
		return
	}

	attachmentsPayload := make([]MessageAttachment, 0, len(attachmentIDs))
	if len(attachmentIDs) > 0 {
		messageIDRef := &messageID
		rowsAffected, claimErr := qtx.ClaimChatBlobsForMessage(context.Background(), sqldb.ClaimChatBlobsForMessageParams{
			MessageID:  messageIDRef,
			ClaimedAt:  &createdAt,
			UploadedBy: c.user.ID,
			Now:        &createdAt,
			BlobIds:    attachmentIDs,
		})
		if claimErr != nil {
			slog.Error("error claiming message attachments", "component", "ws", "error", claimErr)
			return
		}
		if rowsAffected != int64(len(attachmentIDs)) {
			c.send <- &WSMessage{
				Op:   OpDispatch,
				Type: EventError,
				Data: ErrorPayload{
					Code:    ErrCodeAttachmentInvalid,
					Message: "One or more attachments are no longer available",
					Nonce:   nonce,
				},
			}
			return
		}

		dbAttachments, listErr := qtx.ListMessageAttachments(context.Background(), messageIDRef)
		if listErr != nil {
			slog.Error("error loading message attachments", "component", "ws", "error", listErr)
			return
		}

		attachmentsPayload = make([]MessageAttachment, 0, len(dbAttachments))
		for _, attachment := range dbAttachments {
			mapped := MessageAttachment{
				ID:       attachment.ID,
				Name:     attachment.OriginalName,
				MimeType: attachment.MimeType,
				Size:     attachment.SizeBytes,
				URL:      mediaurl.Blob(c.hub.baseURL, attachment.ID),
			}
			if attachment.PreviewStoragePath != nil {
				mapped.PreviewURL = mediaurl.BlobPreview(c.hub.baseURL, attachment.ID)
			}
			if attachment.PreviewWidth != nil {
				mapped.PreviewWidth = *attachment.PreviewWidth
			}
			if attachment.PreviewHeight != nil {
				mapped.PreviewHeight = *attachment.PreviewHeight
			}
			attachmentsPayload = append(attachmentsPayload, mapped)
		}
	}

	if err := tx.Commit(); err != nil {
		slog.Error("error committing message transaction", "component", "ws", "error", err)
		return
	}

	c.hub.BroadcastDispatch(EventMessageCreate, MessageCreatePayload{
		ID: messageID,
		Author: &MessageAuthor{
			ID:       c.user.ID,
			Username: c.user.Username,
			Avatar:   c.user.GetAvatarURL(),
		},
		Content:     content,
		Attachments: attachmentsPayload,
		CreatedAt:   createdAt.Format(time.RFC3339Nano),
		Nonce:       nonce,
	})
}

func normalizeAttachmentIDs(raw []string) []string {
	if len(raw) == 0 {
		return nil
	}

	result := make([]string, 0, len(raw))
	seen := make(map[string]struct{}, len(raw))
	for _, value := range raw {
		id := strings.TrimSpace(value)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}

	return result
}

func (c *Client) handlePresenceSet(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	var data PresenceSetPayload
	if !c.decodeDispatchData(msg, &data) {
		return
	}

	status := data.Status

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
	c.stopAuthExpiryTimer()

	c.sendCloseOnce.Do(func() { close(c.send) })
	if c.transitionTo(ClientStateClosing) {
		c.runCloseCallbacks()
		c.connCloseOnce.Do(func() { c.conn.Close() })
		c.transitionTo(ClientStateClosed)
	}
}

func (c *Client) handleVoiceJoin(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	var data VoiceJoinPayload
	if !c.decodeDispatchData(msg, &data) {
		return
	}

	if c.hub.GetVoiceLifecycleState(c.user.ID) != VoiceLifecycleNotInVoice {
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:    ErrCodeVoiceStateInvalidTransition,
				Message: "Cannot join voice from current state",
			},
		}
		return
	}

	now := time.Now()

	// Check if in join cooldown
	if now.Before(c.voiceJoinCooldownAt) {
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:       ErrCodeVoiceJoinCooldown,
				Message:    "",
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
				Code:       ErrCodeVoiceJoinCooldown,
				Message:    "",
				RetryAfter: c.voiceJoinCooldownAt.UnixMilli(),
			},
		}
		return
	}

	muted := data.Muted
	deafened := data.Deafened

	if err := c.hub.BeginVoiceJoin(c.user.ID, muted, deafened); err != nil {
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:    ErrCodeVoiceStateInvalidTransition,
				Message: "Cannot join voice from current state",
			},
		}
		return
	}

	sfuInst := c.hub.GetSFU()
	if sfuInst != nil {
		_, err := sfuInst.AddPeer(c.user.ID)
		if err != nil {
			c.hub.DiscardVoiceSession(c.user.ID)
			slog.Error("error creating SFU peer", "component", "ws", "user_id", c.user.ID, "error", err)
			c.send <- &WSMessage{
				Op:   OpDispatch,
				Type: EventError,
				Data: ErrorPayload{
					Code:    ErrCodeVoiceJoinFailed,
					Message: "Failed to join voice",
				},
			}
			return
		}
	}

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
		ICEServers: iceServers,
	})

	// Then send initial offer - client's listeners are now ready
	// Server initiates offers to ensure it's always the ICE controlling agent
	if sfuInst != nil {
		if err := sfuInst.SendInitialOffer(c.user.ID); err != nil {
			c.hub.DiscardVoiceSession(c.user.ID)
			sfuInst.RemovePeer(c.user.ID)
			slog.Error("error sending initial offer", "component", "ws", "user_id", c.user.ID, "error", err)
			c.send <- &WSMessage{
				Op:   OpDispatch,
				Type: EventError,
				Data: ErrorPayload{
					Code:    ErrCodeVoiceNegotiationFailed,
					Message: "Failed to start voice negotiation",
				},
			}
			return
		}
	}

	slog.Info("user joined voice", "component", "ws", "user_id", c.user.ID, "muted", muted, "deafened", deafened)
}

func (c *Client) handleVoiceLeave() {
	if !c.IsIdentified() {
		return
	}

	_, removed := c.hub.RemoveUserFromVoice(c.user.ID)
	if !removed {
		return
	}

	c.hub.cleanupVoiceForUser(c.user.ID)

	slog.Info("user left voice", "component", "ws", "user_id", c.user.ID)
}

func (c *Client) handleRtcOffer(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	state := c.hub.GetVoiceLifecycleState(c.user.ID)
	if state != VoiceLifecycleJoining && state != VoiceLifecycleActive {
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:    ErrCodeVoiceNegotiationInvalidState,
				Message: "RTC offer rejected in current voice state",
			},
		}
		return
	}

	var data RtcOfferPayload
	if !c.decodeDispatchData(msg, &data) {
		slog.Warn("invalid RTC_OFFER payload", "component", "ws", "user_id", c.user.ID)
		return
	}

	sdp := data.SDP
	if sdp == "" {
		slog.Warn("missing SDP in RTC_OFFER", "component", "ws", "user_id", c.user.ID)
		return
	}

	answerSDP, err := c.hub.HandleRtcOffer(c.user.ID, sdp)
	if err != nil {
		slog.Error("error handling RTC offer", "component", "ws", "user_id", c.user.ID, "error", err)
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:    ErrCodeVoiceNegotiationFailed,
				Message: "Failed to process RTC offer",
			},
		}
		return
	}

	// Empty answer means offer was ignored (e.g., offer collision - server is impolite peer)
	if answerSDP == "" {
		return
	}

	c.hub.SendDispatchToUser(c.user.ID, EventRtcAnswer, RtcAnswerPayload{
		SDP: answerSDP,
	})

	slog.Debug("processed RTC offer", "component", "ws", "user_id", c.user.ID)
}

func (c *Client) handleRtcAnswer(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	state := c.hub.GetVoiceLifecycleState(c.user.ID)
	if state != VoiceLifecycleJoining && state != VoiceLifecycleActive {
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:    ErrCodeVoiceNegotiationInvalidState,
				Message: "RTC answer rejected in current voice state",
			},
		}
		return
	}

	var data RtcAnswerPayload
	if !c.decodeDispatchData(msg, &data) {
		slog.Warn("invalid RTC_ANSWER payload", "component", "ws", "user_id", c.user.ID)
		return
	}

	sdp := data.SDP
	if sdp == "" {
		slog.Warn("missing SDP in RTC_ANSWER", "component", "ws", "user_id", c.user.ID)
		return
	}

	if err := c.hub.HandleRtcAnswer(c.user.ID, sdp); err != nil {
		slog.Error("error handling RTC answer", "component", "ws", "user_id", c.user.ID, "error", err)
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:    ErrCodeVoiceNegotiationFailed,
				Message: "Failed to process RTC answer",
			},
		}
		return
	}

	if state == VoiceLifecycleJoining {
		voiceState, err := c.hub.ActivateVoiceSession(c.user.ID)
		if err != nil {
			c.send <- &WSMessage{
				Op:   OpDispatch,
				Type: EventError,
				Data: ErrorPayload{
					Code:    ErrCodeVoiceStateInvalidTransition,
					Message: "Cannot activate voice session",
				},
			}
			return
		}

		c.hub.BroadcastDispatch(EventVoiceStateUpdate, VoiceStateUpdatePayload{
			UserID:   c.user.ID,
			InVoice:  true,
			Muted:    voiceState.Muted,
			Deafened: voiceState.Deafened,
		})
	}

	slog.Debug("processed RTC answer", "component", "ws", "user_id", c.user.ID)
}

func (c *Client) handleRtcIceCandidate(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	state := c.hub.GetVoiceLifecycleState(c.user.ID)
	if state != VoiceLifecycleJoining && state != VoiceLifecycleActive {
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:    ErrCodeVoiceNegotiationInvalidState,
				Message: "ICE candidate rejected in current voice state",
			},
		}
		return
	}

	var data RtcIceCandidatePayload
	if !c.decodeDispatchData(msg, &data) {
		slog.Warn("invalid RTC_ICE_CANDIDATE payload", "component", "ws", "user_id", c.user.ID)
		return
	}

	candidate := data.Candidate
	if candidate == "" {
		slog.Warn("missing candidate in RTC_ICE_CANDIDATE", "component", "ws", "user_id", c.user.ID)
		return
	}

	if err := c.hub.HandleRtcIceCandidate(c.user.ID, candidate, data.SDPMid, data.SDPMLineIndex); err != nil {
		slog.Error("error handling ICE candidate", "component", "ws", "user_id", c.user.ID, "error", err)
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:    ErrCodeVoiceNegotiationFailed,
				Message: "Failed to process ICE candidate",
			},
		}
		return
	}
}

func (c *Client) handleVoiceStateSet(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	var data VoiceStateSetPayload
	if !c.decodeDispatchData(msg, &data) {
		return
	}

	if c.hub.GetVoiceLifecycleState(c.user.ID) != VoiceLifecycleActive {
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:    ErrCodeVoiceStateInvalidTransition,
				Message: "Voice state updates require an active voice session",
			},
		}
		return
	}

	// Speaking: broadcast directly with no rate limit (must be in voice)
	if data.Speaking != nil {
		if c.hub.GetUserVoiceState(c.user.ID) != nil {
			c.hub.BroadcastDispatch(EventVoiceSpeaking, VoiceSpeakingPayload{
				UserID:   c.user.ID,
				Speaking: *data.Speaking,
			})
		}
	}

	// Mute/deafen changes
	muted := data.Muted
	deafened := data.Deafened

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
					Code:       ErrCodeVoiceStateCooldown,
					Message:    "",
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
					Code:       ErrCodeVoiceStateCooldown,
					Message:    "",
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
	if c.hub.GetVoiceLifecycleState(c.user.ID) != VoiceLifecycleActive {
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:    ErrCodeVoiceNotInChannel,
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
	slog.Info("user requested screen share", "component", "ws", "user_id", c.user.ID)
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
	slog.Info("user stopped screen share", "component", "ws", "user_id", c.user.ID)
}

func (c *Client) handleScreenShareSubscribe(msg *WSMessage) {
	if !c.IsIdentified() {
		return
	}

	// Must be in voice to subscribe to screen shares
	if c.hub.GetVoiceLifecycleState(c.user.ID) != VoiceLifecycleActive {
		c.send <- &WSMessage{
			Op:   OpDispatch,
			Type: EventError,
			Data: ErrorPayload{
				Code:    ErrCodeVoiceNotInChannel,
				Message: "Must be in voice to subscribe to screen share",
			},
		}
		return
	}

	var data ScreenShareSubscribePayload
	if !c.decodeDispatchData(msg, &data) {
		return
	}

	streamerID := data.StreamerID
	if streamerID == "" {
		return
	}

	sm := c.hub.GetScreenShareManager()
	if sm == nil {
		return
	}

	if err := sm.Subscribe(c.user.ID, streamerID); err != nil {
		slog.Error("error subscribing to screen share", "component", "ws", "error", err)
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
