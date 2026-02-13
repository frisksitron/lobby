package ws

import (
	"time"

	"lobby/internal/constants"
	"lobby/internal/models"
)

// Operation codes for WebSocket messages
type OpCode int

// ProtocolVersion is the exact server/client WS protocol version.
// Bump this only for breaking wire-contract changes.
const ProtocolVersion = 1

const (
	// DISPATCH - Events and commands with type field
	OpDispatch OpCode = 0

	// Lifecycle ops (Server -> Client)
	OpHello          OpCode = 1 // Sent on connection
	OpReady          OpCode = 2 // Sent after successful identify, contains initial state
	OpInvalidSession OpCode = 3 // Session invalid, must re-identify
)

// Event types (Server -> Client via DISPATCH)
const (
	EventPresenceUpdate    = "PRESENCE_UPDATE"
	EventMessageCreate     = "MESSAGE_CREATE"
	EventTypingStart       = "TYPING_START"
	EventTypingStop        = "TYPING_STOP"
	EventUserUpdate        = "USER_UPDATE"
	EventVoiceStateUpdate  = "VOICE_STATE_UPDATE"
	EventRtcReady          = "RTC_READY"
	EventRtcOffer          = "RTC_OFFER"
	EventRtcAnswer         = "RTC_ANSWER"
	EventRtcIceCandidate   = "RTC_ICE_CANDIDATE"
	EventVoiceSpeaking     = "VOICE_SPEAKING"
	EventUserJoined        = "USER_JOINED"
	EventUserLeft          = "USER_LEFT"
	EventError             = "ERROR"
	EventScreenShareUpdate = "SCREEN_SHARE_UPDATE"
)

// Command types (Client -> Server via DISPATCH)
const (
	CmdIdentify               = "IDENTIFY"
	CmdPresenceSet            = "PRESENCE_SET"
	CmdMessageSend            = "MESSAGE_SEND"
	CmdTyping                 = "TYPING"
	CmdVoiceJoin              = "VOICE_JOIN"
	CmdVoiceLeave             = "VOICE_LEAVE"
	CmdRtcOffer               = "RTC_OFFER"
	CmdRtcAnswer              = "RTC_ANSWER"
	CmdRtcIceCandidate        = "RTC_ICE_CANDIDATE"
	CmdVoiceStateSet          = "VOICE_STATE_SET"
	CmdScreenShareStart       = "SCREEN_SHARE_START"
	CmdScreenShareStop        = "SCREEN_SHARE_STOP"
	CmdScreenShareSubscribe   = "SCREEN_SHARE_SUBSCRIBE"
	CmdScreenShareUnsubscribe = "SCREEN_SHARE_UNSUBSCRIBE"
)

// Error codes sent in EventError payloads.
const (
	ErrCodeAuthFailed                   = constants.ErrCodeAuthFailed
	ErrCodeAuthExpired                  = constants.ErrCodeAuthExpired
	ErrCodeRateLimited                  = constants.ErrCodeRateLimited
	ErrCodeMessageTooLong               = constants.ErrCodeMessageTooLong
	ErrCodeVoiceJoinCooldown            = constants.ErrCodeVoiceJoinCooldown
	ErrCodeVoiceStateCooldown           = constants.ErrCodeVoiceStateCooldown
	ErrCodeVoiceJoinFailed              = constants.ErrCodeVoiceJoinFailed
	ErrCodeVoiceNotInChannel            = constants.ErrCodeVoiceNotInChannel
	ErrCodeVoiceStateInvalidTransition  = constants.ErrCodeVoiceStateInvalidTransition
	ErrCodeVoiceNegotiationInvalidState = constants.ErrCodeVoiceNegotiationInvalidState
	ErrCodeVoiceNegotiationFailed       = constants.ErrCodeVoiceNegotiationFailed
	ErrCodeVoiceNegotiationTimeout      = constants.ErrCodeVoiceNegotiationTimeout
	ErrCodeSignalingRateLimited         = constants.ErrCodeSignalingRateLimited
)

type WSMessage struct {
	Op   OpCode      `json:"op"`
	Type string      `json:"t,omitempty"` // Event/command type (only for DISPATCH)
	Data interface{} `json:"d,omitempty"`
}

// Server -> Client payloads

type HelloPayload struct{}

type ReadyPayload struct {
	ProtocolVersion int           `json:"protocol_version"`
	SessionID       string        `json:"session_id"`
	User            *ReadyUser    `json:"user"`
	Members         []MemberState `json:"members"`
}

type ReadyUser struct {
	ID        string     `json:"id"`
	Username  string     `json:"username"`
	Email     string     `json:"email,omitempty"`
	AvatarURL string     `json:"avatar_url,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
}

func NewReadyUser(user *models.User) *ReadyUser {
	if user == nil {
		return nil
	}

	return &ReadyUser{
		ID:        user.ID,
		Username:  user.Username,
		Email:     user.Email,
		AvatarURL: user.GetAvatarURL(),
		CreatedAt: user.CreatedAt,
		UpdatedAt: user.UpdatedAt,
	}
}

type MemberState struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Avatar    string    `json:"avatar_url,omitempty"`
	Status    string    `json:"status"` // online, idle, dnd, offline
	InVoice   bool      `json:"in_voice"`
	Muted     bool      `json:"muted"`
	Deafened  bool      `json:"deafened"`
	Streaming bool      `json:"streaming"`
	CreatedAt time.Time `json:"created_at"`
}

// InvalidSessionPayload sent when session is invalid
type InvalidSessionPayload struct {
	Resumable bool `json:"resumable"`
}

// MessageCreatePayload sent when a new message is created (via DISPATCH)
type MessageCreatePayload struct {
	ID        string         `json:"id"`
	Author    *MessageAuthor `json:"author"`
	Content   string         `json:"content"`
	CreatedAt string         `json:"created_at"`
	Nonce     string         `json:"nonce,omitempty"` // Echo back for optimistic updates
}

type MessageAuthor struct {
	ID       string `json:"id"`
	Username string `json:"username,omitempty"`
	Avatar   string `json:"avatar_url,omitempty"`
}

type PresenceUpdatePayload struct {
	UserID string `json:"user_id"`
	Status string `json:"status"`
}

type TypingStartPayload struct {
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	Timestamp string `json:"timestamp"`
}

type TypingStopPayload struct {
	UserID string `json:"user_id"`
}

type UserUpdatePayload struct {
	ID       string `json:"id"`
	Username string `json:"username,omitempty"`
	Avatar   string `json:"avatar_url,omitempty"`
}

// Client -> Server payloads (via DISPATCH)

// IdentifyPayload sent by client to authenticate
type IdentifyPayload struct {
	Token    string           `json:"token"`
	Presence *PresenceOptions `json:"presence,omitempty"`
}

// PresenceOptions for initial presence on IDENTIFY
type PresenceOptions struct {
	Status string `json:"status"` // online, idle, dnd (not offline)
}

// MessageSendPayload sent by client to send a message
type MessageSendPayload struct {
	Content string `json:"content"`
	Nonce   string `json:"nonce,omitempty"` // Client-generated ID for tracking
}

// PresenceSetPayload sent by client to set presence
type PresenceSetPayload struct {
	Status string `json:"status"` // online, idle, dnd, offline
}

// VoiceStateUpdatePayload sent when a user's voice state changes (via DISPATCH)
type VoiceStateUpdatePayload struct {
	UserID   string `json:"user_id"`
	InVoice  bool   `json:"in_voice"`
	Muted    bool   `json:"muted"`
	Deafened bool   `json:"deafened"`
}

// VoiceJoinPayload sent by client to join voice
type VoiceJoinPayload struct {
	Muted    bool `json:"muted"`
	Deafened bool `json:"deafened"`
}

// RTC Payload types

// RtcReadyPayload sent when client joins voice and should start WebRTC
type RtcReadyPayload struct {
	ICEServers []ICEServerInfo `json:"ice_servers"`
}

// ICEServerInfo for client configuration
type ICEServerInfo struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// RtcOfferPayload contains SDP offer
type RtcOfferPayload struct {
	SDP string `json:"sdp"`
}

// RtcAnswerPayload contains SDP answer
type RtcAnswerPayload struct {
	SDP string `json:"sdp"`
}

// RtcIceCandidatePayload contains ICE candidate
type RtcIceCandidatePayload struct {
	Candidate     string  `json:"candidate"`
	SDPMid        *string `json:"sdp_mid,omitempty"`
	SDPMLineIndex *uint16 `json:"sdp_mline_index,omitempty"`
}

// VoiceStateSetPayload for mute/deafen/speaking changes
type VoiceStateSetPayload struct {
	Muted    *bool `json:"muted,omitempty"`
	Deafened *bool `json:"deafened,omitempty"`
	Speaking *bool `json:"speaking,omitempty"`
}

// UserJoinedPayload sent when server membership is created or restored.
type UserJoinedPayload struct {
	Member MemberState `json:"member"`
}

// UserLeftPayload sent when a user leaves the server (account deactivated)
type UserLeftPayload struct {
	UserID string `json:"user_id"`
}

// VoiceSpeakingPayload broadcast when speaking state changes
type VoiceSpeakingPayload struct {
	UserID   string `json:"user_id"`
	Speaking bool   `json:"speaking"`
}

// ErrorPayload sent when the server rejects a client action
type ErrorPayload struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Nonce      string `json:"nonce,omitempty"`
	RetryAfter int64  `json:"retry_after,omitempty"` // Unix ms timestamp
}

// ScreenShareUpdatePayload sent when a user's screen share state changes
type ScreenShareUpdatePayload struct {
	UserID    string `json:"user_id"`
	Streaming bool   `json:"streaming"`
}

// ScreenShareSubscribePayload sent by client to subscribe to a stream
type ScreenShareSubscribePayload struct {
	StreamerID string `json:"streamer_id"`
}
