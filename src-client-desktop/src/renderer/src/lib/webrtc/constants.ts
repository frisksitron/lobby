// WebRTC and Voice Activity Detection constants

// VAD (Voice Activity Detection) configuration
export const VAD_THRESHOLD = 0.02 // Audio level threshold for speaking detection (0-1 scale)
export const VAD_SAMPLE_INTERVAL_MS = 50 // ms between audio level checks
export const VAD_HOLD_TIME_MS = 250 // ms to hold "speaking" state after audio drops below threshold
export const VAD_FFT_SIZE = 512 // FFT size for audio analysis

// Audio encoding
export const AUDIO_BITRATE_BPS = 128_000 // 128 kbps Opus encoding bitrate
