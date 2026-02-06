import { useSettings } from "../../stores/settings"
import { createLogger } from "../logger"
import { getSharedAudioContext, getSharedAudioContextIfExists } from "./audio-context"

const log = createLogger("Audio")

interface AudioNode {
  gain: GainNode
  source: MediaStreamAudioSourceNode
  element: HTMLAudioElement
}

/**
 * AudioManager handles playback of remote audio streams
 * Uses Web Audio API with GainNode for 0-200% volume control
 */
class AudioManager {
  private audioNodes: Map<string, AudioNode> = new Map()
  private userVolumes: Map<string, number> = new Map() // 0-200 scale
  private deafened = false
  private outputDeviceApplied = false

  /**
   * Load user volumes from settings
   */
  loadUserVolumes(volumes: Record<string, number>): void {
    for (const [userId, volume] of Object.entries(volumes)) {
      this.userVolumes.set(userId, volume)
    }
    log.info(`Loaded volumes for ${this.userVolumes.size} users`)
  }

  /**
   * Apply the saved output device setting to the audio context.
   * Called when joining voice to ensure the correct device is used from the start.
   */
  applyOutputDevice(): void {
    if (this.outputDeviceApplied) return

    const { settings } = useSettings()
    const outputDeviceId = settings().outputDevice
    if (outputDeviceId !== "default") {
      this.setOutputDevice(outputDeviceId)
    }
    this.outputDeviceApplied = true
  }

  /**
   * Add a remote audio stream for a user
   */
  addStream(userId: string, stream: MediaStream): void {
    log.info(`Adding stream for user ${userId}`)

    // Remove existing element if any
    this.removeStream(userId)

    // Use shared audio context to avoid memory leaks
    const ctx = getSharedAudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const gain = ctx.createGain()

    // Set initial gain based on stored volume (default 100 = 1.0)
    const volume = this.userVolumes.get(userId) ?? 100
    gain.gain.value = this.deafened ? 0 : volume / 100

    // Connect: source -> gain -> destination
    source.connect(gain)
    gain.connect(ctx.destination)

    // Create a hidden audio element for output device selection
    // Note: The audio element is muted; actual audio goes through Web Audio API
    const element = document.createElement("audio")
    element.srcObject = stream
    element.muted = true // Muted because audio goes through Web Audio API

    // Resume context if suspended (autoplay policy)
    if (ctx.state === "suspended") {
      ctx.resume().catch((err) => {
        log.error("Failed to resume audio context:", err)
      })
    }

    this.audioNodes.set(userId, { gain, source, element })
    log.info(`Now playing ${this.audioNodes.size} streams (volume: ${volume}%)`)
  }

  /**
   * Remove a user's audio stream
   */
  removeStream(userId: string): void {
    const node = this.audioNodes.get(userId)
    if (node) {
      node.source.disconnect()
      node.gain.disconnect()
      node.element.srcObject = null
      this.audioNodes.delete(userId)
      log.info(`Removed stream for user ${userId}`)
    }
  }

  /**
   * Remove all audio streams
   */
  removeAllStreams(): void {
    this.audioNodes.forEach((node, userId) => {
      node.source.disconnect()
      node.gain.disconnect()
      node.element.srcObject = null
      log.info(`Removed stream for user ${userId}`)
    })
    this.audioNodes.clear()
    this.outputDeviceApplied = false
    log.info("All streams removed")
  }

  /**
   * Set deafened state (mutes all remote audio)
   */
  setDeafened(deafened: boolean): void {
    this.deafened = deafened
    const ctx = getSharedAudioContext()
    this.audioNodes.forEach((node, userId) => {
      const volume = this.userVolumes.get(userId) ?? 100
      const targetGain = deafened ? 0 : volume / 100
      // Smooth transition
      node.gain.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.01)
    })
    log.info(`Deafened: ${deafened}`)
  }

  /**
   * Set volume for a specific user (0-200)
   * Uses smooth transition to avoid audio pops
   */
  setUserVolume(userId: string, volume: number): void {
    const clampedVolume = Math.max(0, Math.min(200, volume))
    this.userVolumes.set(userId, clampedVolume)

    const node = this.audioNodes.get(userId)
    if (node && !this.deafened) {
      // Smooth transition over 10ms
      const ctx = getSharedAudioContext()
      node.gain.gain.setTargetAtTime(clampedVolume / 100, ctx.currentTime, 0.01)
    }
  }

  /**
   * Get volume for a specific user (0-200)
   */
  getUserVolume(userId: string): number {
    return this.userVolumes.get(userId) ?? 100
  }

  /**
   * Set volume for all users (0-200)
   */
  setMasterVolume(volume: number): void {
    const clampedVolume = Math.max(0, Math.min(200, volume))
    const ctx = getSharedAudioContext()
    this.audioNodes.forEach((node, userId) => {
      this.userVolumes.set(userId, clampedVolume)
      if (!this.deafened) {
        node.gain.gain.setTargetAtTime(clampedVolume / 100, ctx.currentTime, 0.01)
      }
    })
  }

  /**
   * Set output device for all audio playback
   */
  setOutputDevice(deviceId: string): void {
    const ctx = getSharedAudioContextIfExists()
    if (!ctx) return
    if (!("setSinkId" in ctx)) {
      log.error("setSinkId not supported on this AudioContext")
      return
    }

    const sinkId = deviceId === "default" ? "" : deviceId
    ;(ctx as AudioContext & { setSinkId: (id: string) => Promise<void> })
      .setSinkId(sinkId)
      .then(() => {
        log.info(`Output device set to: ${deviceId}`)
      })
      .catch((err: Error) => {
        log.error("Failed to set output device:", err)
      })
  }

  /**
   * Get number of active streams
   */
  getStreamCount(): number {
    return this.audioNodes.size
  }

  /**
   * Check if deafened
   */
  isDeafened(): boolean {
    return this.deafened
  }
}

// Export singleton instance
export const audioManager = new AudioManager()
export { AudioManager }
