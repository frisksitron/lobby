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
  AUDIO_SAMPLE_RATE,
  BUNDLE_POLICY,
  ICE_RESTART_DELAY_MS,
  ICE_RESTART_MAX_ATTEMPTS,
  PLAYOUT_DELAY_HINT,
  RTCP_MUX_POLICY
} from "./constants"
import { type AudioPipeline, createAudioPipeline } from "./noise-suppressor"
import { createVAD, type SpeakingCallback } from "./vad"

const log = createLogger("WebRTC")

type WebRTCState = "disconnected" | "connecting" | "connected" | "failed"

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
    this.setupSignalingListeners()

    try {
      const { settings } = useSettings()
      const inputDeviceId = settings().inputDevice
      const noiseSuppressionAlgorithm = settings().noiseSuppression
      const useCustomSuppression = noiseSuppressionAlgorithm !== "none"

      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: !useCustomSuppression,
          autoGainControl: true,
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

      this.audioPipeline = await createAudioPipeline({
        audioContext,
        algorithm: noiseSuppressionAlgorithm,
        enabled: useCustomSuppression
      })

      this.processedStream = this.audioPipeline.process(this.localStream)
      this.setupVAD(audioContext)
    } catch (err) {
      log.error("Failed to get user media:", err)
      this.state = "failed"
      throw err
    }

    // Wait for warmup to complete before creating peer connection
    await getWarmupPromise()
    this.createPeerConnection()

    const streamToSend = this.processedStream || this.localStream
    if (streamToSend && this.peerConnection) {
      for (const track of streamToSend.getAudioTracks()) {
        const sender = this.peerConnection.addTrack(track, streamToSend)
        const params = sender.getParameters()
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}]
        }
        params.encodings[0].maxBitrate = AUDIO_BITRATE_BPS
        await sender.setParameters(params)
      }
    }

    await this.createAndSendOffer()
  }

  /**
   * Stop WebRTC connection
   */
  stop(): void {
    log.info("Stopping...")

    this.clearAnswerTimeout()
    this.clearIceRestartTimeout()
    this.makingOffer = false

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
  }

  /**
   * Set muted state
   * @param notifyServer - If true, sends update to server. Set to false when using setVoiceState for combined updates.
   */
  setMuted(muted: boolean, notifyServer: boolean = true): void {
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
      }
    }
  }

  private async createAndSendOffer(): Promise<void> {
    if (!this.peerConnection) return

    log.info("Creating offer")
    this.makingOffer = true

    try {
      // Create transceiver and set codec preferences
      const transceiver = this.peerConnection.addTransceiver("audio", { direction: "sendrecv" })

      // Prioritize Opus codec
      const codecs = RTCRtpReceiver.getCapabilities("audio")?.codecs
      if (codecs) {
        const opus = codecs.filter((c) => c.mimeType === "audio/opus")
        const others = codecs.filter((c) => c.mimeType !== "audio/opus")
        transceiver.setCodecPreferences([...opus, ...others])
      }

      const offer = await this.peerConnection.createOffer()
      await this.peerConnection.setLocalDescription(offer)

      log.info("Sending offer")
      wsManager.sendRtcOffer(offer.sdp || "")

      this.startAnswerTimeout()
    } finally {
      this.makingOffer = false
    }
  }

  private startAnswerTimeout(): void {
    this.clearAnswerTimeout()
    this.answerTimeout = setTimeout(() => {
      if (this.state === "connecting") {
        log.error("Answer timeout - no response from server within", ANSWER_TIMEOUT_MS, "ms")
        this.stop()
        this.state = "failed"
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

    this.clearAnswerTimeout()

    const answer = new RTCSessionDescription({ type: "answer", sdp })
    await this.peerConnection.setRemoteDescription(answer)
    log.info("Set remote description (answer)")
  }

  private async handleOffer(sdp: string): Promise<void> {
    if (!this.peerConnection) return

    // Perfect negotiation: client is the "polite" peer
    // Check for offer collision: we're making an offer while receiving one
    const offerCollision = this.makingOffer || this.peerConnection.signalingState !== "stable"

    // As the polite peer, we always accept incoming offers (rollback if needed)
    if (offerCollision) {
      log.info("Offer collision detected - rolling back local offer (polite peer)")
    }

    const offer = new RTCSessionDescription({ type: "offer", sdp })
    await this.peerConnection.setRemoteDescription(offer)

    const answer = await this.peerConnection.createAnswer()
    await this.peerConnection.setLocalDescription(answer)

    log.info("Sending answer (renegotiation)")
    if (!answer.sdp) throw new Error("Answer SDP is empty")
    wsManager.sendRtcAnswer(answer.sdp)
  }

  private async handleIceCandidate(payload: RtcIceCandidatePayload): Promise<void> {
    if (!this.peerConnection) return

    const candidate = new RTCIceCandidate({
      candidate: payload.candidate,
      sdpMid: payload.sdpMid,
      sdpMLineIndex: payload.sdpMLineIndex
    })

    await this.peerConnection.addIceCandidate(candidate)
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
   * Update noise suppression settings at runtime
   */
  updateNoiseSuppressionSettings(enabled: boolean, algorithm: NoiseSuppressionAlgorithm): void {
    this.audioPipeline?.configure({ enabled, algorithm })
    log.info(`Updated noise suppression: enabled=${enabled}, algorithm=${algorithm}`)
  }
}

export const webrtcManager = new WebRTCManager()
export { WebRTCManager }
