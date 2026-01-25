// Voice Activity Detection module
import { createLogger } from "../logger"
import { VAD_FFT_SIZE, VAD_HOLD_TIME_MS, VAD_SAMPLE_INTERVAL_MS, VAD_THRESHOLD } from "./constants"

const log = createLogger("VAD")

export type SpeakingCallback = (speaking: boolean) => void

interface VADState {
  audioContext: AudioContext | null
  analyser: AnalyserNode | null
  sourceNode: MediaStreamAudioSourceNode | null
  interval: ReturnType<typeof setInterval> | null
  isSpeaking: boolean
  lastSpeakingTime: number
}

/**
 * Create a new VAD instance
 */
export function createVAD(): {
  start: (
    audioContext: AudioContext,
    stream: MediaStream,
    onSpeakingChange: SpeakingCallback
  ) => void
  stop: () => void
  isSpeaking: () => boolean
} {
  const state: VADState = {
    audioContext: null,
    analyser: null,
    sourceNode: null,
    interval: null,
    isSpeaking: false,
    lastSpeakingTime: 0
  }

  /**
   * Start voice activity detection on a media stream
   */
  function start(
    audioContext: AudioContext,
    stream: MediaStream,
    onSpeakingChange: SpeakingCallback
  ): void {
    if (state.interval) {
      stop()
    }

    try {
      state.audioContext = audioContext
      state.analyser = audioContext.createAnalyser()
      state.analyser.fftSize = VAD_FFT_SIZE

      state.sourceNode = audioContext.createMediaStreamSource(stream)
      state.sourceNode.connect(state.analyser)

      const dataArray = new Float32Array(state.analyser.fftSize)

      state.interval = setInterval(() => {
        if (!state.analyser) return

        // Get time-domain waveform data (-1 to 1 range)
        state.analyser.getFloatTimeDomainData(dataArray)

        // Find peak amplitude for transient detection
        let peak = 0
        for (let i = 0; i < dataArray.length; i++) {
          const abs = Math.abs(dataArray[i])
          if (abs > peak) peak = abs
        }

        const now = Date.now()
        const wasSpeaking = state.isSpeaking

        if (peak > VAD_THRESHOLD) {
          // Audio detected above threshold - update time and mark speaking
          state.lastSpeakingTime = now
          state.isSpeaking = true
        } else if (state.isSpeaking) {
          // Audio below threshold while speaking - check if hold time expired
          if (now - state.lastSpeakingTime > VAD_HOLD_TIME_MS) {
            state.isSpeaking = false
          }
        }

        // Only trigger callback if speaking state changed
        if (wasSpeaking !== state.isSpeaking) {
          onSpeakingChange(state.isSpeaking)
        }
      }, VAD_SAMPLE_INTERVAL_MS)
    } catch (err) {
      log.error("Failed to start:", err)
    }
  }

  /**
   * Stop voice activity detection
   */
  function stop(): void {
    if (state.interval) {
      clearInterval(state.interval)
      state.interval = null
    }

    if (state.sourceNode) {
      try {
        state.sourceNode.disconnect()
      } catch {
        // Ignore disconnect errors
      }
      state.sourceNode = null
    }

    state.audioContext = null
    state.analyser = null
    state.isSpeaking = false
    state.lastSpeakingTime = 0
  }

  /**
   * Check if currently speaking
   */
  function isSpeaking(): boolean {
    return state.isSpeaking
  }

  return {
    start,
    stop,
    isSpeaking
  }
}
