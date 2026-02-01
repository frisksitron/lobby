import { createSignal } from "solid-js"
import type { LocalVoiceState } from "../../../shared/types"
import { ERROR_CODES, getErrorMessage } from "../lib/errors/user-messages"
import { createLogger } from "../lib/logger"
import { playSound } from "../lib/sounds"
import { audioManager, webrtcManager } from "../lib/webrtc"
import type { WebRTCError } from "../lib/webrtc/manager"
import type { RtcReadyPayload, VoiceSpeakingPayload } from "../lib/ws"
import { wsManager } from "../lib/ws"
import { clearStatus, setStatus } from "./status"
import { updateUser, users } from "./users"

const log = createLogger("Voice")

const [localVoice, setLocalVoice] = createSignal<LocalVoiceState>({
  connecting: false,
  inVoice: false,
  muted: false,
  deafened: false
})

// Reconnection state
let wasInVoice = false
let voiceStateBeforeDisconnect = { muted: false, deafened: false }

// Confirmed state from server (for cooldown recovery)
let confirmedMuted = false
let confirmedDeafened = false

let getCurrentUserId: () => string | null = () => null
let getSessionStatus: () => string | null = () => null
let stopScreenShareFn: (() => void) | null = null

export function initVoice(
  currentUserIdGetter: () => string | null,
  sessionStatusGetter: () => string | null,
  stopScreenShare: () => void
): void {
  getCurrentUserId = currentUserIdGetter
  getSessionStatus = sessionStatusGetter
  stopScreenShareFn = stopScreenShare

  // Set up WebRTC error handling
  webrtcManager.onError(handleWebRTCError)
}

/**
 * Handle WebRTC errors and surface them to the status panel
 */
function handleWebRTCError(error: WebRTCError): void {
  log.error("WebRTC error:", error.code, error.message)

  // Map WebRTC error codes to status codes
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

  setStatus({
    type: "voice",
    code: statusCode,
    message
  })
}

/**
 * Clear all voice-related error statuses (called on successful voice join)
 */
function clearVoiceErrors(): void {
  clearStatus(ERROR_CODES.MEDIA_PERMISSION_DENIED)
  clearStatus(ERROR_CODES.NO_DEVICE)
  clearStatus(ERROR_CODES.DEVICE_NOT_FOUND)
  clearStatus(ERROR_CODES.DEVICE_IN_USE)
  clearStatus(ERROR_CODES.ICE_FAILED)
  clearStatus(ERROR_CODES.ICE_RESTART_EXHAUSTED)
  clearStatus(ERROR_CODES.OFFER_TIMEOUT)
}

export function handleVoiceStateUpdate(payload: {
  user_id: string
  in_voice: boolean
  muted: boolean
  deafened: boolean
}): void {
  const userId = getCurrentUserId()
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
    confirmedMuted = payload.muted
    confirmedDeafened = payload.deafened

    if (payload.in_voice) {
      // If connecting, preserve connecting state - handleRtcReady will set inVoice
      if (voice.connecting) {
        setLocalVoice((prev) => ({
          ...prev,
          muted: payload.muted,
          deafened: payload.deafened
        }))
      } else {
        // Not connecting, set full state (e.g., server-initiated state change)
        setLocalVoice((prev) => ({
          ...prev,
          inVoice: true,
          muted: payload.muted,
          deafened: payload.deafened
        }))
      }
    } else {
      // Server says we're not in voice - reset everything
      setLocalVoice({
        connecting: false,
        inVoice: false,
        muted: false,
        deafened: false
      })
    }
  }

  if (!payload.in_voice) {
    audioManager.removeStream(payload.user_id)
  }
}

export async function handleRtcReady(payload: RtcReadyPayload): Promise<void> {
  log.info("RTC ready, starting WebRTC")

  const iceServers: RTCIceServer[] = (payload.ice_servers ?? []).map((server) => ({
    urls: server.urls,
    username: server.username,
    credential: server.credential
  }))

  const userId = getCurrentUserId()
  const voice = localVoice()

  try {
    await webrtcManager.start(iceServers)

    // Apply initial mute/deafen state now that streams are ready
    if (voice.muted || voice.deafened) {
      webrtcManager.setVoiceState(voice.muted, voice.deafened)
    }

    // Now mark as fully connected - clear any previous voice errors
    clearVoiceErrors()
    playSound("user-join")
    setLocalVoice((prev) => ({ ...prev, connecting: false, inVoice: true }))
    if (userId) {
      updateUser(userId, {
        inVoice: true,
        voiceMuted: voice.muted,
        voiceDeafened: voice.deafened,
        voiceSpeaking: false
      })
    }

    webrtcManager.onSpeaking((speaking) => {
      const id = getCurrentUserId()
      if (id) {
        updateUser(id, { voiceSpeaking: speaking })
      }
    })
  } catch (err) {
    log.error("Failed to start WebRTC:", err)
    setLocalVoice({ connecting: false, inVoice: false, muted: false, deafened: false })
  }
}

export function handleVoiceSpeaking(payload: VoiceSpeakingPayload): void {
  updateUser(payload.user_id, { voiceSpeaking: payload.speaking })
}

export function handleVoiceStateCooldown(): void {
  const userId = getCurrentUserId()
  if (userId) {
    setLocalVoice((prev) => ({
      ...prev,
      muted: confirmedMuted,
      deafened: confirmedDeafened
    }))
    updateUser(userId, {
      voiceMuted: confirmedMuted,
      voiceDeafened: confirmedDeafened
    })
    // Rollback WebRTC audio state to match confirmed server state
    webrtcManager.setMuted(confirmedMuted, false)
    webrtcManager.setDeafened(confirmedDeafened, false)
  }
}

export function handleVoiceJoinCooldown(): void {
  const userId = getCurrentUserId()
  if (userId) {
    setLocalVoice({ connecting: false, inVoice: false, muted: false, deafened: false })
    updateUser(userId, {
      inVoice: false,
      voiceMuted: false,
      voiceDeafened: false,
      voiceSpeaking: false
    })
  }
}

export function stopVoice(): void {
  const voice = localVoice()
  if (voice.inVoice || voice.connecting) {
    webrtcManager.stop()
    setLocalVoice({ connecting: false, inVoice: false, muted: false, deafened: false })
  }
}

export function joinVoice(): void {
  const userId = getCurrentUserId()
  if (!userId || getSessionStatus() !== "connected") return

  setLocalVoice({ connecting: true, inVoice: false, muted: false, deafened: false })
  wsManager.joinVoice(false, false)
}

export function rejoinVoice(muted: boolean, deafened: boolean): void {
  const userId = getCurrentUserId()
  if (!userId) return

  setLocalVoice({ connecting: true, inVoice: false, muted, deafened })
  wsManager.joinVoice(muted, deafened)
}

export function leaveVoice(): void {
  // Stop screen share if active
  if (stopScreenShareFn) {
    stopScreenShareFn()
  }

  setLocalVoice({ connecting: false, inVoice: false, muted: false, deafened: false })

  const userId = getCurrentUserId()
  if (userId) {
    updateUser(userId, {
      inVoice: false,
      voiceMuted: false,
      voiceDeafened: false,
      voiceSpeaking: false
    })
  }

  wsManager.leaveVoice()
  playSound("user-leave")
  webrtcManager.stop()
}

export function toggleMute(): void {
  const userId = getCurrentUserId()
  const voice = localVoice()
  if (!voice.inVoice || !userId) return

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

export function toggleDeafen(): void {
  const userId = getCurrentUserId()
  const voice = localVoice()
  if (!voice.inVoice || !userId) return

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

export function saveVoiceStateForReconnect(): void {
  const voiceState = localVoice()
  if (voiceState.inVoice) {
    wasInVoice = true
    voiceStateBeforeDisconnect = { muted: voiceState.muted, deafened: voiceState.deafened }
  }
}

export function restoreVoiceAfterReconnect(): void {
  if (wasInVoice) {
    wasInVoice = false
    const { muted, deafened } = voiceStateBeforeDisconnect
    rejoinVoice(muted, deafened)
  }
}

export function resetVoiceReconnectState(): void {
  wasInVoice = false
}

export { localVoice }

export function useVoice() {
  return {
    localVoice,
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleDeafen
  }
}
