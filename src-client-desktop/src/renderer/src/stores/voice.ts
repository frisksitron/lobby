import { createEffect, createRoot, createSignal, on } from "solid-js"
import type { LocalVoiceState } from "../../../shared/types"
import { connectionService } from "../lib/connection"
import { ERROR_CODES, getErrorMessage } from "../lib/errors/user-messages"
import { createLogger } from "../lib/logger"
import { playSound } from "../lib/sounds"
import { audioManager, webrtcManager } from "../lib/webrtc"
import type { WebRTCError } from "../lib/webrtc/manager"
import type {
  ErrorPayload,
  RtcReadyPayload,
  VoiceSpeakingPayload,
  VoiceStateUpdatePayload
} from "../lib/ws"
import { wsManager } from "../lib/ws"
import { stopScreenShare } from "./screen-share"
import { useSettings } from "./settings"
import { clearStatus, setStatus } from "./status"
import { updateUser, users } from "./users"

const log = createLogger("Voice")

type VoiceLifecycleState = "not_in_voice" | "joining" | "active" | "leaving"

const VOICE_TRANSITIONS: Record<VoiceLifecycleState, VoiceLifecycleState[]> = {
  not_in_voice: ["joining"],
  joining: ["active", "leaving"],
  active: ["leaving"],
  leaving: ["not_in_voice"]
}

const STARTUP_FAILURE_CODES = new Set<WebRTCError["code"]>([
  "media_permission_denied",
  "no_device",
  "device_not_found",
  "device_in_use",
  "offer_timeout"
])

const [localVoice, setLocalVoice] = createSignal<LocalVoiceState>({
  connecting: false,
  inVoice: false,
  muted: false,
  deafened: false
})

const [voiceLifecycle, setVoiceLifecycle] = createSignal<VoiceLifecycleState>("not_in_voice")
let leaveInFlight = false

// Confirmed state from server (for cooldown recovery)
const [confirmedState, setConfirmedState] = createSignal({ muted: false, deafened: false })

// Reconnection state
const [reconnectState, setReconnectState] = createSignal({
  wasInVoice: false,
  muted: false,
  deafened: false
})

function transitionVoiceLifecycle(
  next: VoiceLifecycleState,
  source: string,
  force: boolean = false
): boolean {
  const current = voiceLifecycle()
  if (current === next) {
    return true
  }

  const allowed = VOICE_TRANSITIONS[current]?.includes(next) ?? false
  if (!allowed && !force) {
    log.warn("Ignored invalid voice transition", { current, next, source })
    return false
  }

  if (!allowed && force) {
    log.warn("Forced voice transition", { current, next, source })
  }

  setVoiceLifecycle(next)
  return true
}

function resetLocalVoiceState(source: string): void {
  setLocalVoice({ connecting: false, inVoice: false, muted: false, deafened: false })
  transitionVoiceLifecycle("not_in_voice", source, true)
}

function sendVoiceLeaveIdempotent(reason: string): void {
  if (leaveInFlight) {
    return
  }

  leaveInFlight = true
  try {
    if (connectionService.getSession()?.status === "connected") {
      wsManager.leaveVoice()
      log.info("Sent VOICE_LEAVE during cleanup", { reason })
    }
  } finally {
    queueMicrotask(() => {
      leaveInFlight = false
    })
  }
}

function cleanupVoiceStartupFailure(reason: string): void {
  const lifecycle = voiceLifecycle()
  const voice = localVoice()
  if (lifecycle !== "joining" && !voice.connecting) {
    return
  }

  transitionVoiceLifecycle("leaving", `startup-failure:${reason}`, true)
  sendVoiceLeaveIdempotent(reason)
  webrtcManager.stop()

  const userId = connectionService.getUserId()
  if (userId) {
    updateUser(userId, {
      inVoice: false,
      voiceMuted: false,
      voiceDeafened: false,
      voiceSpeaking: false
    })
  }

  resetLocalVoiceState(`startup-failure:${reason}`)
}

// Set up WebRTC error handling
webrtcManager.onError(handleWebRTCError)

function handleWebRTCError(error: WebRTCError): void {
  log.error("WebRTC error:", error.code, error.message)

  const statusCodeMap: Record<string, string> = {
    media_permission_denied: ERROR_CODES.MEDIA_PERMISSION_DENIED,
    no_device: ERROR_CODES.NO_DEVICE,
    device_not_found: ERROR_CODES.DEVICE_NOT_FOUND,
    device_in_use: ERROR_CODES.DEVICE_IN_USE,
    ice_failed: ERROR_CODES.ICE_FAILED,
    ice_restart_exhausted: ERROR_CODES.ICE_RESTART_EXHAUSTED,
    offer_timeout: ERROR_CODES.OFFER_TIMEOUT
  }

  const statusCode = statusCodeMap[error.code] || `webrtc.${error.code}`
  const message = getErrorMessage(statusCode)

  setStatus({ type: "voice", code: statusCode, message })

  if (STARTUP_FAILURE_CODES.has(error.code)) {
    cleanupVoiceStartupFailure(`webrtc:${error.code}`)
  }
}

function clearVoiceErrors(): void {
  clearStatus(ERROR_CODES.MEDIA_PERMISSION_DENIED)
  clearStatus(ERROR_CODES.NO_DEVICE)
  clearStatus(ERROR_CODES.DEVICE_NOT_FOUND)
  clearStatus(ERROR_CODES.DEVICE_IN_USE)
  clearStatus(ERROR_CODES.ICE_FAILED)
  clearStatus(ERROR_CODES.ICE_RESTART_EXHAUSTED)
  clearStatus(ERROR_CODES.OFFER_TIMEOUT)
}

function handleVoiceStateUpdate(payload: VoiceStateUpdatePayload): void {
  const userId = connectionService.getUserId()
  const isCurrentUser = userId && payload.user_id === userId
  const previousUser = users[payload.user_id]
  const wasInVoiceChannel = previousUser?.inVoice ?? false
  const isNowInVoice = payload.in_voice
  const voice = localVoice()

  // Play sounds when we're in voice or connecting
  if (!isCurrentUser && wasInVoiceChannel !== isNowInVoice && (voice.inVoice || voice.connecting)) {
    playSound(isNowInVoice ? "user-join" : "user-leave")
  }

  updateUser(payload.user_id, {
    inVoice: payload.in_voice,
    voiceMuted: payload.muted,
    voiceDeafened: payload.deafened,
    voiceSpeaking: payload.in_voice ? (previousUser?.voiceSpeaking ?? false) : false
  })

  if (isCurrentUser) {
    setConfirmedState({ muted: payload.muted, deafened: payload.deafened })

    if (payload.in_voice) {
      if (!voice.inVoice) {
        playSound("user-join")
      }

      transitionVoiceLifecycle("active", "server-voice-state", true)
      setLocalVoice((prev) => ({
        ...prev,
        connecting: false,
        inVoice: true,
        muted: payload.muted,
        deafened: payload.deafened
      }))
    } else {
      resetLocalVoiceState("server-voice-state")
    }
  }

  if (!payload.in_voice) {
    audioManager.removeStream(payload.user_id)
  }
}

async function handleRtcReady(payload: RtcReadyPayload): Promise<void> {
  log.info("RTC ready, starting WebRTC")

  if (voiceLifecycle() !== "joining") {
    log.warn("Ignoring RTC_READY in non-joining state", { state: voiceLifecycle() })
    return
  }

  const iceServers: RTCIceServer[] = (payload.ice_servers ?? []).map((server) => ({
    urls: server.urls,
    username: server.username,
    credential: server.credential
  }))

  const userId = connectionService.getUserId()
  const voice = localVoice()

  try {
    await webrtcManager.start(iceServers)

    if (voice.muted || voice.deafened) {
      webrtcManager.setVoiceState(voice.muted, voice.deafened)
    }

    clearVoiceErrors()
    if (userId) {
      updateUser(userId, {
        voiceMuted: voice.muted,
        voiceDeafened: voice.deafened,
        voiceSpeaking: false
      })
    }

    webrtcManager.onSpeaking((speaking) => {
      const id = connectionService.getUserId()
      if (id) {
        updateUser(id, { voiceSpeaking: speaking })
      }
    })
  } catch (err) {
    log.error("Failed to start WebRTC:", err)
    cleanupVoiceStartupFailure("rtc-ready-start")
  }
}

function handleVoiceSpeaking(payload: VoiceSpeakingPayload): void {
  updateUser(payload.user_id, { voiceSpeaking: payload.speaking })
}

function handleVoiceStateCooldown(): void {
  const userId = connectionService.getUserId()
  if (userId) {
    const { muted, deafened } = confirmedState()
    setLocalVoice((prev) => ({ ...prev, muted, deafened }))
    updateUser(userId, { voiceMuted: muted, voiceDeafened: deafened })
    webrtcManager.setMuted(muted, false)
    webrtcManager.setDeafened(deafened, false)
  }
}

function handleVoiceJoinCooldown(): void {
  resetLocalVoiceState("voice-join-cooldown")

  const userId = connectionService.getUserId()
  if (userId) {
    updateUser(userId, {
      inVoice: false,
      voiceMuted: false,
      voiceDeafened: false,
      voiceSpeaking: false
    })
  }
}

function handleServerError(payload: ErrorPayload): void {
  if (payload.code === "VOICE_STATE_COOLDOWN") {
    handleVoiceStateCooldown()
    const expiresAt = payload.retry_after ?? Date.now() + 10_000
    setStatus({
      type: "voice",
      code: ERROR_CODES.VOICE_COOLDOWN,
      message: getErrorMessage(ERROR_CODES.VOICE_COOLDOWN),
      expiresAt
    })
  } else if (payload.code === "VOICE_JOIN_COOLDOWN") {
    handleVoiceJoinCooldown()
    const expiresAt = payload.retry_after ?? Date.now() + 15_000
    setStatus({
      type: "voice",
      code: ERROR_CODES.VOICE_JOIN_COOLDOWN,
      message: getErrorMessage(ERROR_CODES.VOICE_JOIN_COOLDOWN),
      expiresAt
    })
  } else if (payload.code === "VOICE_JOIN_FAILED") {
    setStatus({
      type: "voice",
      code: ERROR_CODES.VOICE_JOIN_FAILED,
      message: getErrorMessage(ERROR_CODES.VOICE_JOIN_FAILED)
    })
    cleanupVoiceStartupFailure("server:VOICE_JOIN_FAILED")
  } else if (payload.code === "VOICE_STATE_INVALID_TRANSITION") {
    setStatus({
      type: "voice",
      code: ERROR_CODES.VOICE_STATE_INVALID_TRANSITION,
      message: getErrorMessage(ERROR_CODES.VOICE_STATE_INVALID_TRANSITION),
      expiresAt: Date.now() + 5_000
    })
  } else if (payload.code === "VOICE_NEGOTIATION_INVALID_STATE") {
    setStatus({
      type: "voice",
      code: ERROR_CODES.VOICE_NEGOTIATION_INVALID_STATE,
      message: getErrorMessage(ERROR_CODES.VOICE_NEGOTIATION_INVALID_STATE),
      expiresAt: Date.now() + 5_000
    })
  } else if (payload.code === "VOICE_NEGOTIATION_FAILED") {
    setStatus({
      type: "voice",
      code: ERROR_CODES.VOICE_NEGOTIATION_FAILED,
      message: getErrorMessage(ERROR_CODES.VOICE_NEGOTIATION_FAILED)
    })
    cleanupVoiceStartupFailure("server:VOICE_NEGOTIATION_FAILED")
  } else if (payload.code === "VOICE_NEGOTIATION_TIMEOUT") {
    setStatus({
      type: "voice",
      code: ERROR_CODES.VOICE_NEGOTIATION_TIMEOUT,
      message: getErrorMessage(ERROR_CODES.VOICE_NEGOTIATION_TIMEOUT)
    })
    cleanupVoiceStartupFailure("server:VOICE_NEGOTIATION_TIMEOUT")
  } else if (payload.code === "SIGNALING_RATE_LIMITED") {
    const expiresAt = payload.retry_after ?? Date.now() + 2_000
    setStatus({
      type: "voice",
      code: ERROR_CODES.SIGNALING_RATE_LIMITED,
      message: getErrorMessage(ERROR_CODES.SIGNALING_RATE_LIMITED),
      expiresAt
    })
  }
}

function stopVoice(): void {
  const voice = localVoice()
  if (voice.inVoice || voice.connecting || voiceLifecycle() !== "not_in_voice") {
    webrtcManager.stop()
    resetLocalVoiceState("stop-voice")
  }
}

function joinVoice(): void {
  const userId = connectionService.getUserId()
  if (!userId || connectionService.getSession()?.status !== "connected") return
  if (!transitionVoiceLifecycle("joining", "joinVoice")) return

  setLocalVoice({ connecting: true, inVoice: false, muted: false, deafened: false })
  wsManager.joinVoice(false, false)
}

function rejoinVoice(muted: boolean, deafened: boolean): void {
  const userId = connectionService.getUserId()
  if (!userId) return
  if (!transitionVoiceLifecycle("joining", "rejoinVoice")) return

  setLocalVoice({ connecting: true, inVoice: false, muted, deafened })
  wsManager.joinVoice(muted, deafened)
}

function leaveVoice(): void {
  const lifecycle = voiceLifecycle()
  if (lifecycle !== "joining" && lifecycle !== "active") {
    log.warn("Ignored leaveVoice in invalid state", { lifecycle })
    return
  }
  transitionVoiceLifecycle("leaving", "leaveVoice", true)

  stopScreenShare()

  resetLocalVoiceState("leaveVoice")

  const userId = connectionService.getUserId()
  if (userId) {
    updateUser(userId, {
      inVoice: false,
      voiceMuted: false,
      voiceDeafened: false,
      voiceSpeaking: false
    })
  }

  sendVoiceLeaveIdempotent("leaveVoice")
  playSound("user-leave")
  webrtcManager.stop()
}

function toggleMute(): void {
  const userId = connectionService.getUserId()
  const voice = localVoice()
  if (voiceLifecycle() !== "active" || !voice.inVoice || !userId) {
    log.warn("Ignored mute toggle in invalid state", { lifecycle: voiceLifecycle() })
    return
  }

  const newMuted = !voice.muted

  if (!newMuted && voice.deafened) {
    playSound("undeafen")
  } else {
    playSound(newMuted ? "mute" : "unmute")
  }

  if (!newMuted && voice.deafened) {
    setLocalVoice((prev) => ({ ...prev, muted: false, deafened: false }))
    updateUser(userId, { voiceMuted: false, voiceDeafened: false })
    webrtcManager.setVoiceState(false, false)
  } else {
    setLocalVoice((prev) => ({ ...prev, muted: newMuted }))
    updateUser(userId, { voiceMuted: newMuted })
    webrtcManager.setMuted(newMuted)
  }
}

function toggleDeafen(): void {
  const userId = connectionService.getUserId()
  const voice = localVoice()
  if (voiceLifecycle() !== "active" || !voice.inVoice || !userId) {
    log.warn("Ignored deafen toggle in invalid state", { lifecycle: voiceLifecycle() })
    return
  }

  const newDeafened = !voice.deafened
  playSound(newDeafened ? "deafen" : "undeafen")

  if (newDeafened) {
    setLocalVoice((prev) => ({ ...prev, muted: true, deafened: true }))
    updateUser(userId, { voiceMuted: true, voiceDeafened: true })
    webrtcManager.setVoiceState(true, true)
  } else {
    setLocalVoice((prev) => ({ ...prev, muted: false, deafened: false }))
    updateUser(userId, { voiceMuted: false, voiceDeafened: false })
    webrtcManager.setVoiceState(false, false)
  }
}

function saveVoiceStateForReconnect(): void {
  const voiceState = localVoice()
  if (voiceState.inVoice) {
    setReconnectState({ wasInVoice: true, muted: voiceState.muted, deafened: voiceState.deafened })
  }
}

function restoreVoiceAfterReconnect(): void {
  const state = reconnectState()
  if (state.wasInVoice) {
    setReconnectState({ wasInVoice: false, muted: false, deafened: false })
    rejoinVoice(state.muted, state.deafened)
  }
}

function resetVoiceReconnectState(): void {
  setReconnectState({ wasInVoice: false, muted: false, deafened: false })
  transitionVoiceLifecycle("not_in_voice", "reset-reconnect", true)
}

// Subscribe to WS events
connectionService.on("voice_state_update", handleVoiceStateUpdate)
connectionService.on("rtc_ready", handleRtcReady)
connectionService.on("voice_speaking", handleVoiceSpeaking)
connectionService.on("server_error", handleServerError)

// Subscribe to lifecycle events
connectionService.onLifecycle("voice_save", saveVoiceStateForReconnect)
connectionService.onLifecycle("voice_restore", restoreVoiceAfterReconnect)
connectionService.onLifecycle("voice_reset", resetVoiceReconnectState)
connectionService.onLifecycle("voice_stop", stopVoice)

// Settings effects — apply audio settings globally regardless of VoiceSettings mount state
createRoot(() => {
  const { settings } = useSettings()

  createEffect(
    on(
      () => settings().noiseSuppression,
      (algorithm, prev) => {
        if (algorithm === prev) return
        webrtcManager.updateNoiseSuppressionSettings(algorithm !== "none", algorithm)
      },
      { defer: true }
    )
  )

  createEffect(
    on(
      () => settings().echoCancellation,
      (echoCancellation, prev) => {
        if (echoCancellation === prev) return
        webrtcManager.restartAudioCapture()
      },
      { defer: true }
    )
  )

  createEffect(
    on(
      () => settings().compressor,
      (enabled, prev) => {
        if (enabled === prev) return
        webrtcManager.updateCompressorSettings(enabled)
      },
      { defer: true }
    )
  )

  createEffect(
    on(
      () => settings().inputDevice,
      (deviceId, prev) => {
        if (deviceId === prev) return
        webrtcManager.restartAudioCapture()
      },
      { defer: true }
    )
  )

  createEffect(
    on(
      () => settings().outputDevice,
      (deviceId, prev) => {
        if (deviceId === prev) return
        audioManager.setOutputDevice(deviceId)
      },
      { defer: true }
    )
  )
})

export function useVoice() {
  return {
    localVoice,
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleDeafen
  }
}
