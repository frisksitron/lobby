/**
 * User-friendly error messages for various error codes
 * These messages are shown in the status panel when issues occur
 */
export const ERROR_MESSAGES: Record<string, string> = {
  // WebRTC / Media errors
  "webrtc.media_permission_denied": "Microphone access denied. Check browser permissions.",
  "webrtc.no_device": "No microphone found.",
  "webrtc.device_not_found": "Microphone not available.",
  "webrtc.device_in_use": "Microphone is in use by another application.",
  "webrtc.ice_failed": "Voice connection failed. Please rejoin.",
  "webrtc.ice_restart_exhausted": "Voice connection lost. Please rejoin.",
  "webrtc.offer_timeout": "Voice server not responding.",

  // WebSocket / Voice rate limits
  "ws.voice_cooldown": "Too many voice toggles. Wait a moment.",
  "ws.voice_join_cooldown": "Joining voice too quickly.",
  "ws.rate_limited": "Sending messages too fast.",

  // API errors
  "api.rate_limited": "Too many requests. Try again shortly.",
  "api.server_error": "Server error. Please try again.",
  "api.network_error": "Network error. Check your connection."
}

/**
 * Get user-friendly message for an error code
 * Falls back to the error code itself if no mapping exists
 */
export function getErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] || code
}

/**
 * Error codes for status panel
 */
export const ERROR_CODES = {
  // WebRTC
  MEDIA_PERMISSION_DENIED: "webrtc.media_permission_denied",
  NO_DEVICE: "webrtc.no_device",
  DEVICE_NOT_FOUND: "webrtc.device_not_found",
  DEVICE_IN_USE: "webrtc.device_in_use",
  ICE_FAILED: "webrtc.ice_failed",
  ICE_RESTART_EXHAUSTED: "webrtc.ice_restart_exhausted",
  OFFER_TIMEOUT: "webrtc.offer_timeout",

  // WebSocket
  VOICE_COOLDOWN: "ws.voice_cooldown",
  VOICE_JOIN_COOLDOWN: "ws.voice_join_cooldown",
  MESSAGE_RATE_LIMITED: "ws.rate_limited",

  // API
  API_RATE_LIMITED: "api.rate_limited",
  API_SERVER_ERROR: "api.server_error",
  API_NETWORK_ERROR: "api.network_error"
} as const
