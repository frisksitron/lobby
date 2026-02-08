import type { NoiseSuppressionAlgorithm } from "../../../../shared/types"
import { useSettings } from "../../stores/settings"
import { createLogger } from "../logger"
import { wsManager } from "../ws"
import type { RtcAnswerPayload, RtcIceCandidatePayload, RtcOfferPayload } from "../ws/types"
import { audioManager } from "./audio"
import { closeSharedAudioContext, getSharedAudioContext } from "./audio-context"
import {
  AUDIO_BITRATE_BPS,
  AUDIO_CHANNELS,
  AUDIO_NETWORK_PRIORITY,
  AUDIO_PRIORITY,
  AUDIO_SAMPLE_RATE,
  BUNDLE_POLICY,
  ICE_RESTART_DELAY_MS,
  ICE_RESTART_MAX_ATTEMPTS,
  PLAYOUT_DELAY_HINT,
  RTCP_MUX_POLICY
} from "./constants"
import { type AudioPipeline, createAudioPipeline } from "./noise-suppressor"
import { screenShareManager } from "./screenshare"
import { createVAD, type SpeakingCallback } from "./vad"

const log = createLogger("WebRTC")

type WebRTCState = "disconnected" | "connecting" | "connected" | "failed"

/**
 * WebRTC error codes for status notifications
 */
export type WebRTCErrorCode =
  | "media_permission_denied"
  | "no_device"
  | "device_not_found"
  | "device_in_use"
  | "ice_failed"
  | "ice_restart_exhausted"
  | "offer_timeout"

export interface WebRTCError {
  code: WebRTCErrorCode
  message: string
}

export type ErrorCallback = (error: WebRTCError) => void

// 10 seconds - long enough for slow TURN relay setup, short enough to feel responsive
const ANSWER_TIMEOUT_MS = 10_000

// Warm up WebRTC stack by creating a dummy peer connection
// This pre-initializes Chromium's WebRTC internals so the real connection is faster
let warmupPromise: Promise<void> | null = null

export function warmupWebRTC(): void {
  if (warmupPromise) return
  // Start warmup in next tick to avoid blocking the ready handler
  warmupPromise = new Promise((resolve) => setTimeout(resolve, 0)).then(doWarmup)
}

export function getWarmupPromise(): Promise<void> {
  return warmupPromise ?? Promise.resolve()
}

async function doWarmup(): Promise<void> {
  const start = performance.now()
  log.info("Warming up WebRTC...")
  try {
    // Create and immediately close a dummy peer connection
    // This initializes WebRTC internals without TURN allocation
    const dummy = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    })
    dummy.close()
    log.info(`WebRTC warmup complete in ${(performance.now() - start).toFixed(1)}ms`)
  } catch (err) {
    log.warn("WebRTC warmup failed:", err)
  }
}

class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private processedStream: MediaStream | null = null
  private audioPipeline: AudioPipeline | null = null
  private state: WebRTCState = "disconnected"
  private iceServers: RTCIceServer[] = []
  private wsUnsubscribes: (() => void)[] = []
  private speakingCallback: SpeakingCallback | null = null
  private vad = createVAD()
  private answerTimeout: ReturnType<typeof setTimeout> | null = null
  private iceRestartAttempts = 0
  private iceRestartTimeout: ReturnType<typeof setTimeout> | null = null
  // Perfect negotiation: client is always polite (yields to server offers)
  private makingOffer = false
  // Track pending negotiation requests (for deferred negotiation when not in stable state)
  private needsNegotiation = false
  // Track whether the initial offer has been handled (prevents duplicate addTrack on early renegotiation)
  private initialOfferHandled = false
  private muted = false
  // Promise that resolves when audio stream is ready
  private audioReadyPromise: Promise<void> | null = null
  private audioReadyResolve: (() => void) | null = null
  // Error callback for status notifications
  private errorCallback: ErrorCallback | null = null

  /**
   * Start WebRTC connection with voice chat
   */
  async start(iceServers: RTCIceServer[]): Promise<void> {
    if (this.state !== "disconnected") {
      log.info("Already started")
      return
    }

    log.info("Starting...")
    this.state = "connecting"
    this.iceServers = iceServers
    this.initialOfferHandled = false

    // Create promise that resolves when audio stream is ready
    this.audioReadyPromise = new Promise((resolve) => {
      this.audioReadyResolve = resolve
    })

    // Create peer connection first so it's ready to receive the server's initial offer
    // Server always initiates offers to ensure it's the ICE controlling agent
    await getWarmupPromise()
    this.createPeerConnection()
    this.setupSignalingListeners()

    // Start timeout waiting for server's initial offer
    log.info("Waiting for server's initial offer...")
    this.startOfferTimeout()

    // Get audio stream in parallel - will be added when we receive the offer
    try {
      const { settings } = useSettings()
      const inputDeviceId = settings().inputDevice
      const noiseSuppressionAlgorithm = settings().noiseSuppression
      const useCustomSuppression = noiseSuppressionAlgorithm !== "none"

      const echoCancellation = settings().echoCancellation

      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation,
          noiseSuppression: !useCustomSuppression,
          autoGainControl: false,
          deviceId: inputDeviceId !== "default" ? { exact: inputDeviceId } : undefined,
          sampleRate: AUDIO_SAMPLE_RATE,
          channelCount: AUDIO_CHANNELS
        },
        video: false
      })
      log.info("Got local audio stream")

      const audioContext = getSharedAudioContext()
      if (audioContext.state === "suspended") {
        await audioContext.resume()
      }

      // Apply saved output device setting to audio context
      audioManager.applyOutputDevice()

      this.audioPipeline = await createAudioPipeline(this.localStream, {
        audioContext,
        algorithm: noiseSuppressionAlgorithm,
        enabled: useCustomSuppression,
        compressorEnabled: settings().compressor
      })

      this.processedStream = this.audioPipeline.getOutputStream()
      this.setupVAD(audioContext)

      // Signal that audio is ready
      if (this.audioReadyResolve) {
        this.audioReadyResolve()
      }
    } catch (err) {
      log.error("Failed to get user media:", err)
      this.state = "failed"
      // Signal failure so handleOffer doesn't wait forever
      if (this.audioReadyResolve) {
        this.audioReadyResolve()
      }
      // Emit appropriate error based on the DOMException
      this.emitMediaError(err)
      throw err
    }
  }

  /**
   * Parse media error and emit appropriate error code
   */
  private emitMediaError(err: unknown): void {
    if (err instanceof DOMException) {
      switch (err.name) {
        case "NotAllowedError":
          this.emitError("media_permission_denied", "Microphone access denied")
          break
        case "NotFoundError":
          this.emitError("no_device", "No microphone found")
          break
        case "NotReadableError":
          this.emitError("device_in_use", "Microphone is in use by another application")
          break
        case "OverconstrainedError":
          this.emitError("device_not_found", "Selected microphone not available")
          break
        default:
          this.emitError("no_device", `Media error: ${err.message}`)
      }
    } else {
      this.emitError("no_device", "Failed to access microphone")
    }
  }

  /**
   * Stop WebRTC connection
   */
  stop(): void {
    if (this.state === "disconnected" && !this.localStream && !this.peerConnection) return
    log.info("Stopping...")

    // Clean up screen share first
    screenShareManager.onVoiceStopped()

    this.clearAnswerTimeout()
    this.clearIceRestartTimeout()
    this.makingOffer = false
    this.needsNegotiation = false
    this.initialOfferHandled = false
    // Resolve pending audio promise so handleOffer doesn't hang
    if (this.audioReadyResolve) {
      this.audioReadyResolve()
    }
    this.audioReadyPromise = null
    this.audioReadyResolve = null

    this.stopVAD()
    this.audioPipeline?.destroy()
    this.audioPipeline = null
    this.processedStream = null

    for (const unsub of this.wsUnsubscribes) unsub()
    this.wsUnsubscribes = []

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop()
      this.localStream = null
    }

    if (this.peerConnection) {
      this.peerConnection.close()
      this.peerConnection = null
    }

    audioManager.removeAllStreams()
    closeSharedAudioContext()
    this.state = "disconnected"
    this.muted = false
  }

  /**
   * Set muted state
   * @param notifyServer - If true, sends update to server. Set to false when using setVoiceState for combined updates.
   */
  setMuted(muted: boolean, notifyServer: boolean = true): void {
    this.muted = muted
    const streamToMute = this.processedStream || this.localStream
    if (streamToMute) {
      streamToMute.getAudioTracks().forEach((track) => {
        track.enabled = !muted
      })
      log.info(`Muted: ${muted}`)
    }
    if (notifyServer) {
      wsManager.sendVoiceState({ muted })
    }
  }

  /**
   * Set deafened state
   * @param notifyServer - If true, sends update to server. Set to false when using setVoiceState for combined updates.
   */
  setDeafened(deafened: boolean, notifyServer: boolean = true): void {
    audioManager.setDeafened(deafened)
    log.info(`Deafened: ${deafened}`)
    if (notifyServer) {
      wsManager.sendVoiceState({ deafened })
    }
  }

  /**
   * Set both muted and deafened state in a single server update
   * This avoids rate limiting issues when both need to change together
   */
  setVoiceState(muted: boolean, deafened: boolean): void {
    this.setMuted(muted, false)
    this.setDeafened(deafened, false)
    wsManager.sendVoiceState({ muted, deafened })
  }

  /**
   * Set callback for speaking state changes
   */
  onSpeaking(callback: SpeakingCallback): void {
    this.speakingCallback = callback
  }

  /**
   * Set callback for error events (media failures, ICE failures, etc.)
   */
  onError(callback: ErrorCallback): void {
    this.errorCallback = callback
  }

  /**
   * Emit an error to the callback
   */
  private emitError(code: WebRTCErrorCode, message: string): void {
    if (this.errorCallback) {
      this.errorCallback({ code, message })
    }
  }

  /**
   * Get current state
   */
  getState(): WebRTCState {
    return this.state
  }

  /**
   * Get peer connection for stats collection
   */
  getPeerConnection(): RTCPeerConnection | null {
    return this.peerConnection
  }

  private createPeerConnection(): void {
    log.info("Creating peer connection")

    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: BUNDLE_POLICY,
      rtcpMuxPolicy: RTCP_MUX_POLICY,
      iceCandidatePoolSize: 0 // Don't pre-gather - warmup handles WebRTC init
    })

    // Share peer connection with screen share manager
    screenShareManager.setPeerConnection(this.peerConnection)

    // Handle renegotiation needed (when video tracks are added/removed)
    // Client creates offers when adding tracks - this is the standard WebRTC pattern
    this.peerConnection.onnegotiationneeded = async () => {
      // Only skip if peer connection is gone
      if (!this.peerConnection) return

      // Skip if completely disconnected or failed
      // Allow negotiation in "connecting" state - signaling works before ICE completes
      if (this.state === "disconnected" || this.state === "failed") return

      if (this.peerConnection.signalingState !== "stable") {
        // Defer negotiation until signaling is stable
        this.needsNegotiation = true
        return
      }

      await this.doNegotiation()
    }

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        log.info("Sending ICE candidate")
        wsManager.sendRtcIceCandidate(event.candidate)
      }
    }

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState
      log.info("Connection state:", state)

      switch (state) {
        case "connected":
          this.state = "connected"
          this.iceRestartAttempts = 0 // Reset on successful connection
          this.clearIceRestartTimeout()
          break
        case "disconnected":
          // Attempt ICE restart after delay
          this.scheduleIceRestart()
          break
        case "failed":
          this.restartIce()
          break
        case "closed":
          this.state = "disconnected"
          break
      }
    }

    this.peerConnection.ontrack = (event) => {
      log.info("Received remote track:", event.track.kind)

      if (event.track.kind === "audio") {
        // Set playout delay hint for lower latency
        if ("playoutDelayHint" in event.receiver) {
          ;(event.receiver as { playoutDelayHint: number }).playoutDelayHint = PLAYOUT_DELAY_HINT
        }

        if (event.streams[0]) {
          const userId = event.streams[0].id
          audioManager.addStream(userId, event.streams[0])
        }
      } else if (event.track.kind === "video") {
        // Video tracks are handled by screen share manager
        // The stream ID contains the streamer's user ID (set by server in track's msid)
        const streamerId = event.streams[0]?.id
        if (streamerId) {
          screenShareManager.handleRemoteVideoTrack(event.track, streamerId)
        } else {
          log.warn("Received video track without stream association")
        }
      }
    }
  }

  /**
   * Perform the actual negotiation (create and send offer)
   */
  private async doNegotiation(): Promise<void> {
    if (!this.peerConnection || this.peerConnection.signalingState !== "stable") return

    this.needsNegotiation = false
    this.makingOffer = true
    try {
      const offer = await this.peerConnection.createOffer()
      await this.peerConnection.setLocalDescription(offer)
      wsManager.sendRtcOffer(offer.sdp || "")
      log.info("Sent renegotiation offer")
    } catch (err) {
      log.error("Failed to create/send offer:", err)
    } finally {
      this.makingOffer = false
    }
  }

  /**
   * Check if there's a pending negotiation request and process it if signaling is stable
   */
  private checkPendingNegotiation(): void {
    if (this.needsNegotiation && this.peerConnection?.signalingState === "stable") {
      log.info("Processing deferred negotiation")
      this.doNegotiation()
    }
  }

  private startOfferTimeout(): void {
    this.clearAnswerTimeout()
    this.answerTimeout = setTimeout(() => {
      if (this.state === "connecting") {
        log.error("Offer timeout - no initial offer from server within", ANSWER_TIMEOUT_MS, "ms")
        this.emitError("offer_timeout", "Voice server not responding")
        this.stop()
        this.state = "failed"
      }
    }, ANSWER_TIMEOUT_MS)
  }

  private startAnswerTimeout(): void {
    this.clearAnswerTimeout()
    this.answerTimeout = setTimeout(() => {
      if (this.state === "connected") {
        log.error("Answer timeout - no response from server within", ANSWER_TIMEOUT_MS, "ms")
        // For ICE restart, just log - don't stop the connection
      }
    }, ANSWER_TIMEOUT_MS)
  }

  private clearAnswerTimeout(): void {
    if (this.answerTimeout) {
      clearTimeout(this.answerTimeout)
      this.answerTimeout = null
    }
  }

  private clearIceRestartTimeout(): void {
    if (this.iceRestartTimeout) {
      clearTimeout(this.iceRestartTimeout)
      this.iceRestartTimeout = null
    }
  }

  private scheduleIceRestart(): void {
    this.clearIceRestartTimeout()
    this.iceRestartTimeout = setTimeout(() => {
      if (this.peerConnection?.connectionState === "disconnected") {
        this.restartIce()
      }
    }, ICE_RESTART_DELAY_MS)
  }

  private async restartIce(): Promise<void> {
    if (!this.peerConnection || this.iceRestartAttempts >= ICE_RESTART_MAX_ATTEMPTS) {
      log.error("ICE restart failed - max attempts reached")
      this.emitError("ice_restart_exhausted", "Voice connection lost")
      this.state = "failed"
      return
    }

    this.iceRestartAttempts++
    log.info(`ICE restart attempt ${this.iceRestartAttempts}/${ICE_RESTART_MAX_ATTEMPTS}`)

    this.makingOffer = true
    try {
      this.peerConnection.restartIce()
      const offer = await this.peerConnection.createOffer({ iceRestart: true })
      await this.peerConnection.setLocalDescription(offer)
      wsManager.sendRtcOffer(offer.sdp || "")
      this.startAnswerTimeout()
    } finally {
      this.makingOffer = false
    }
  }

  private setupSignalingListeners(): void {
    this.wsUnsubscribes.push(
      wsManager.on("rtc_answer", (payload: RtcAnswerPayload) => {
        log.info("Received answer")
        this.handleAnswer(payload.sdp)
      })
    )

    this.wsUnsubscribes.push(
      wsManager.on("rtc_offer", (payload: RtcOfferPayload) => {
        log.info("Received offer (renegotiation)")
        this.handleOffer(payload.sdp)
      })
    )

    this.wsUnsubscribes.push(
      wsManager.on("rtc_ice_candidate", (payload: RtcIceCandidatePayload) => {
        log.info("Received ICE candidate")
        this.handleIceCandidate(payload)
      })
    )
  }

  private async handleAnswer(sdp: string): Promise<void> {
    if (!this.peerConnection) return

    try {
      if (this.peerConnection.signalingState !== "have-local-offer") {
        log.warn(
          "Ignoring answer - not in have-local-offer state:",
          this.peerConnection.signalingState
        )
        return
      }

      this.clearAnswerTimeout()

      const answer = new RTCSessionDescription({ type: "answer", sdp })
      await this.peerConnection.setRemoteDescription(answer)
      log.info("Set remote description (answer)")

      // Check if there's a pending negotiation request
      this.checkPendingNegotiation()
    } catch (err) {
      log.error("Failed to handle answer:", err)
    }
  }

  private async handleOffer(sdp: string): Promise<void> {
    if (!this.peerConnection) return

    try {
      const isInitialOffer = !this.initialOfferHandled
      this.initialOfferHandled = true
      if (isInitialOffer) {
        this.clearAnswerTimeout()
      }

      // Perfect negotiation: client is the "polite" peer
      // Check for offer collision: we're making an offer while receiving one
      const offerCollision = this.makingOffer || this.peerConnection.signalingState !== "stable"

      // As the polite peer, we always accept incoming offers (rollback if needed)
      if (offerCollision) {
        log.info("Offer collision detected - rolling back local offer (polite peer)")
      }

      const offer = new RTCSessionDescription({ type: "offer", sdp })
      await this.peerConnection.setRemoteDescription(offer)

      // For initial offer, wait for audio stream then add our track before creating the answer
      if (isInitialOffer && this.audioReadyPromise) {
        log.info("Waiting for audio stream to be ready...")
        await this.audioReadyPromise

        const streamToSend = this.processedStream || this.localStream
        if (streamToSend && this.peerConnection) {
          for (const track of streamToSend.getAudioTracks()) {
            this.peerConnection.addTrack(track, streamToSend)
          }
          log.info("Added audio track to peer connection")
        }
      }

      // Activate pending screen share track if server triggered renegotiation for it
      if (screenShareManager.hasPendingTrack()) {
        await screenShareManager.activatePendingShare()
      }

      const answer = await this.peerConnection.createAnswer()
      await this.peerConnection.setLocalDescription(answer)

      // Apply audio parameters AFTER negotiation completes (encodings are now available)
      if (isInitialOffer && this.peerConnection) {
        await this.applyAudioSenderParameters()
      }

      log.info(isInitialOffer ? "Sending answer (initial)" : "Sending answer (renegotiation)")
      if (!answer.sdp) throw new Error("Answer SDP is empty")
      wsManager.sendRtcAnswer(answer.sdp)

      // Check if there's a pending negotiation request (e.g., screen share was initiated
      // while we were handling this server offer)
      this.checkPendingNegotiation()
    } catch (err) {
      log.error("Failed to handle offer:", err)
    }
  }

  private async handleIceCandidate(payload: RtcIceCandidatePayload): Promise<void> {
    if (!this.peerConnection) return

    try {
      const candidate = new RTCIceCandidate({
        candidate: payload.candidate,
        sdpMid: payload.sdpMid,
        sdpMLineIndex: payload.sdpMLineIndex
      })

      await this.peerConnection.addIceCandidate(candidate)
    } catch (err) {
      log.error("Failed to handle ICE candidate:", err)
    }
  }

  private setupVAD(audioContext: AudioContext): void {
    const streamForVAD = this.processedStream || this.localStream
    if (!streamForVAD) return

    this.vad.start(audioContext, streamForVAD, (speaking) => {
      log.info(`Speaking: ${speaking}`)
      wsManager.sendVoiceState({ speaking })

      if (this.speakingCallback) {
        this.speakingCallback(speaking)
      }
    })
  }

  private stopVAD(): void {
    this.vad.stop()
  }

  /**
   * Apply bitrate and priority settings to the audio sender
   * Must be called AFTER negotiation completes (setLocalDescription)
   */
  private async applyAudioSenderParameters(): Promise<void> {
    if (!this.peerConnection) return

    const sender = this.peerConnection.getSenders().find((s) => s.track?.kind === "audio")
    if (!sender) {
      log.warn("No audio sender found")
      return
    }

    try {
      const params = sender.getParameters()
      if (!params.encodings || params.encodings.length === 0) {
        log.warn("No encodings available on audio sender")
        return
      }
      params.encodings[0].maxBitrate = AUDIO_BITRATE_BPS
      params.encodings[0].priority = AUDIO_PRIORITY
      params.encodings[0].networkPriority = AUDIO_NETWORK_PRIORITY
      await sender.setParameters(params)
      log.info("Applied audio parameters: maxBitrate=128kbps, priority=high")
    } catch (err) {
      log.warn("Could not set audio parameters:", err)
    }
  }

  /**
   * Update noise suppression settings at runtime
   */
  updateNoiseSuppressionSettings(enabled: boolean, algorithm: NoiseSuppressionAlgorithm): void {
    this.audioPipeline?.configure({ enabled, algorithm })
    log.info(`Updated noise suppression: enabled=${enabled}, algorithm=${algorithm}`)
  }

  /**
   * Update compressor settings at runtime
   */
  updateCompressorSettings(enabled: boolean): void {
    this.audioPipeline?.configure({ compressorEnabled: enabled })
    log.info(`Updated compressor: enabled=${enabled}`)
  }

  /**
   * Restart audio capture with current settings (for echo cancellation/auto gain changes)
   */
  async restartAudioCapture(): Promise<void> {
    if (this.state !== "connected" || !this.peerConnection) {
      log.info("Not in voice, skipping audio capture restart")
      return
    }

    log.info("Restarting audio capture...")

    const { settings } = useSettings()
    const inputDeviceId = settings().inputDevice
    const noiseSuppressionAlgorithm = settings().noiseSuppression
    const useCustomSuppression = noiseSuppressionAlgorithm !== "none"
    const echoCancellation = settings().echoCancellation

    // Stop VAD before replacing stream
    this.stopVAD()

    // Stop old local stream tracks
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop()
    }

    try {
      // Get new stream with updated constraints
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation,
          noiseSuppression: !useCustomSuppression,
          autoGainControl: false,
          deviceId: inputDeviceId !== "default" ? { exact: inputDeviceId } : undefined,
          sampleRate: AUDIO_SAMPLE_RATE,
          channelCount: AUDIO_CHANNELS
        },
        video: false
      })
      log.info("Got new local audio stream")

      // Destroy old pipeline and create a new one bound to the new stream
      this.audioPipeline?.destroy()
      this.audioPipeline = await createAudioPipeline(this.localStream, {
        audioContext: getSharedAudioContext(),
        algorithm: noiseSuppressionAlgorithm,
        enabled: useCustomSuppression,
        compressorEnabled: settings().compressor
      })
      this.processedStream = this.audioPipeline.getOutputStream()

      // Replace track on sender
      const streamToSend = this.processedStream || this.localStream
      const newTrack = streamToSend?.getAudioTracks()[0]
      if (newTrack) {
        const sender = this.peerConnection.getSenders().find((s) => s.track?.kind === "audio")
        if (sender) {
          await sender.replaceTrack(newTrack)
          log.info("Replaced audio track on sender")

          // Re-apply audio parameters after track replacement
          await this.applyAudioSenderParameters()

          // Restore mute state on new track
          if (this.muted) {
            newTrack.enabled = false
            log.info("Restored mute state on new track")
          }
        }
      }

      // Restart VAD with new stream
      const audioContext = getSharedAudioContext()
      this.setupVAD(audioContext)

      log.info("Audio capture restart complete")
    } catch (err) {
      log.error("Failed to restart audio capture:", err)
    }
  }
}

export const webrtcManager = new WebRTCManager()
export { WebRTCManager }
