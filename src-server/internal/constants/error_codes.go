package constants

const (
	// Shared REST/WS transport-agnostic errors
	ErrCodeAuthFailed        = "AUTH_FAILED"
	ErrCodeAuthExpired       = "AUTH_EXPIRED"
	ErrCodeRateLimited       = "RATE_LIMITED"
	ErrCodeInvalidRequest    = "INVALID_REQUEST"
	ErrCodePayloadTooLarge   = "PAYLOAD_TOO_LARGE"
	ErrCodeNotFound          = "NOT_FOUND"
	ErrCodeConflict          = "CONFLICT"
	ErrCodeInternal          = "INTERNAL_ERROR"
	ErrCodeAttachmentInvalid = "ATTACHMENT_INVALID"

	// Voice / signaling domain errors
	ErrCodeMessageTooLong               = "MESSAGE_TOO_LONG"
	ErrCodeVoiceJoinCooldown            = "VOICE_JOIN_COOLDOWN"
	ErrCodeVoiceStateCooldown           = "VOICE_STATE_COOLDOWN"
	ErrCodeVoiceJoinFailed              = "VOICE_JOIN_FAILED"
	ErrCodeVoiceNotInChannel            = "NOT_IN_VOICE"
	ErrCodeVoiceStateInvalidTransition  = "VOICE_STATE_INVALID_TRANSITION"
	ErrCodeVoiceNegotiationInvalidState = "VOICE_NEGOTIATION_INVALID_STATE"
	ErrCodeVoiceNegotiationFailed       = "VOICE_NEGOTIATION_FAILED"
	ErrCodeVoiceNegotiationTimeout      = "VOICE_NEGOTIATION_TIMEOUT"
	ErrCodeSignalingRateLimited         = "SIGNALING_RATE_LIMITED"
)
