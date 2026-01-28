/**
 * Shared AudioContext for noise suppression and VAD.
 * Uses 48kHz sample rate for RNNoise compatibility.
 */
let sharedAudioContext: AudioContext | null = null

export function getSharedAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContext({
      sampleRate: 48000, // Required for RNNoise
      latencyHint: "interactive" // Optimize for real-time audio
    })
  }
  return sharedAudioContext
}

export function closeSharedAudioContext(): void {
  if (sharedAudioContext) {
    sharedAudioContext.close()
    sharedAudioContext = null
  }
}

export function getSharedAudioContextIfExists(): AudioContext | null {
  return sharedAudioContext
}
