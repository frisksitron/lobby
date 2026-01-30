// WebRTC and Voice Activity Detection constants

// VAD (Voice Activity Detection) configuration
export const VAD_THRESHOLD = 0.003 // Audio level threshold (~-50dB) - sensitive enough for whispers
export const VAD_SAMPLE_INTERVAL_MS = 50 // ms between audio level checks
export const VAD_HOLD_TIME_MS = 300 // ms to hold "speaking" state after audio drops below threshold
export const VAD_FFT_SIZE = 512 // FFT size for audio analysis

// Audio encoding
export const AUDIO_BITRATE_BPS = 128_000 // 128 kbps Opus encoding bitrate
export const AUDIO_SAMPLE_RATE = 48000 // Sample rate for Opus codec
export const AUDIO_CHANNELS = 1 // Mono for voice

// RTCPeerConnection configuration
export const ICE_CANDIDATE_POOL_SIZE = 5
export const BUNDLE_POLICY = "max-bundle" as const
export const RTCP_MUX_POLICY = "require" as const

// Jitter buffer - lower values reduce latency but may cause audio glitches
export const PLAYOUT_DELAY_HINT = 0.02 // 20ms target (aggressive but stable)

// ICE restart for connection recovery
export const ICE_RESTART_DELAY_MS = 2000
export const ICE_RESTART_MAX_ATTEMPTS = 3

// Priority settings - ensure voice is never starved by video
export const AUDIO_PRIORITY = "high" as RTCPriorityType
export const AUDIO_NETWORK_PRIORITY = "high" as RTCPriorityType

// Video (screenshare) - deprioritized to protect voice
export const VIDEO_PRIORITY = "low" as RTCPriorityType
export const VIDEO_NETWORK_PRIORITY = "very-low" as RTCPriorityType
export const VIDEO_MAX_BITRATE_BPS = 2_500_000 // 2.5 Mbps cap
