import { type Accessor, createSignal } from "solid-js"
import type { LocalVoiceState, User } from "../../../shared/types"
import { createLogger } from "../lib/logger"
import { playSound } from "../lib/sounds"
import { audioManager, webrtcManager } from "../lib/webrtc"
import {
  type ErrorPayload,
  type RtcReadyPayload,
  type VoiceSpeakingPayload,
  wsManager
} from "../lib/ws"
import { showToast } from "./ui"
import { getUserById, updateUser } from "./users"

const log = createLogger("Voice")

const [localVoice, setLocalVoice] = createSignal<LocalVoiceState>({
  inVoice: false,
  muted: false,
  deafened: false
})

let confirmedMuted = false
let confirmedDeafened = false

/**
 * Handle voice state updates from WebSocket
 */
export function handleVoiceStateUpdate(
  payload: { user_id: string; in_voice: boolean; muted: boolean; deafened: boolean },
  currentUser: User | null
): void {
  const isCurrentUser = currentUser && payload.user_id === currentUser.id
  const previousUser = getUserById(payload.user_id)
  const wasInVoice = previousUser?.inVoice ?? false
  const isNowInVoice = payload.in_voice

  if (!isCurrentUser && wasInVoice !== isNowInVoice) {
    if (isNowInVoice) {
      playSound("user-join")
    } else {
      playSound("user-leave")
    }
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
    setLocalVoice({
      inVoice: payload.in_voice,
      muted: payload.muted,
      deafened: payload.deafened
    })
  }

  if (!payload.in_voice) {
    audioManager.removeStream(payload.user_id)
  }
}

/**
 * Handle RTC ready from WebSocket (start WebRTC when joining voice)
 */
export async function handleRtcReady(
  payload: RtcReadyPayload,
  getCurrentUser: () => User | null
): Promise<void> {
  log.info("RTC ready, starting WebRTC")

  const iceServers: RTCIceServer[] = (payload.ice_servers ?? []).map((server) => ({
    urls: server.urls,
    username: server.username,
    credential: server.credential
  }))

  try {
    await webrtcManager.start(iceServers)

    webrtcManager.onSpeaking((speaking) => {
      const currentUserValue = getCurrentUser()
      if (currentUserValue) {
        updateUser(currentUserValue.id, { voiceSpeaking: speaking })
      }
    })
  } catch (err) {
    log.error("Failed to start WebRTC:", err)
  }
}

/**
 * Handle voice speaking updates from other users
 */
export function handleVoiceSpeaking(payload: VoiceSpeakingPayload): void {
  updateUser(payload.user_id, { voiceSpeaking: payload.speaking })
}

/**
 * Set up voice-related WebSocket listeners
 */
export function setupVoiceListeners(getCurrentUser: () => User | null): (() => void)[] {
  const unsubscribes: (() => void)[] = []

  unsubscribes.push(
    wsManager.on("voice_state_update", (payload) => {
      handleVoiceStateUpdate(payload, getCurrentUser())
    })
  )

  unsubscribes.push(
    wsManager.on("rtc_ready", (payload: RtcReadyPayload) => {
      handleRtcReady(payload, getCurrentUser)
    })
  )

  unsubscribes.push(
    wsManager.on("voice_speaking", (payload: VoiceSpeakingPayload) => {
      handleVoiceSpeaking(payload)
    })
  )

  unsubscribes.push(
    wsManager.on("server_error", (payload: ErrorPayload) => {
      const user = getCurrentUser()

      if (payload.code === "VOICE_STATE_COOLDOWN") {
        if (user) {
          setLocalVoice((prev) => ({
            ...prev,
            muted: confirmedMuted,
            deafened: confirmedDeafened
          }))
          updateUser(user.id, {
            voiceMuted: confirmedMuted,
            voiceDeafened: confirmedDeafened
          })
        }
        showToast("Too many toggles, try again in a moment", "warning")
      } else if (payload.code === "VOICE_JOIN_COOLDOWN") {
        if (user) {
          setLocalVoice({ inVoice: false, muted: false, deafened: false })
          updateUser(user.id, {
            inVoice: false,
            voiceMuted: false,
            voiceDeafened: false,
            voiceSpeaking: false
          })
        }
        showToast("Joining too fast, slow down", "warning")
      }
    })
  )

  return unsubscribes
}

/**
 * Get the local voice state accessor
 */
export function getLocalVoice(): Accessor<LocalVoiceState> {
  return localVoice
}

/**
 * Join voice channel
 */
export function joinVoice(currentUser: User | null, isConnected: boolean): void {
  if (!currentUser || !isConnected) return

  playSound("user-join")
  setLocalVoice({ inVoice: true, muted: false, deafened: false })
  updateUser(currentUser.id, {
    inVoice: true,
    voiceMuted: false,
    voiceDeafened: false,
    voiceSpeaking: false
  })
  wsManager.joinVoice(false, false)
}

/**
 * Rejoin voice channel after WS reconnect (no sound, preserves mute/deafen state)
 */
export function rejoinVoice(currentUser: User | null, muted: boolean, deafened: boolean): void {
  if (!currentUser) return

  setLocalVoice({ inVoice: true, muted, deafened })
  updateUser(currentUser.id, {
    inVoice: true,
    voiceMuted: muted,
    voiceDeafened: deafened,
    voiceSpeaking: false
  })
  wsManager.joinVoice(muted, deafened)
}

/**
 * Leave voice channel
 */
export function leaveVoice(currentUser: User | null): void {
  setLocalVoice({ inVoice: false, muted: false, deafened: false })

  if (currentUser) {
    updateUser(currentUser.id, {
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

/**
 * Toggle mute state
 */
export function toggleMute(currentUser: User | null): void {
  if (!localVoice().inVoice || !currentUser) return

  const newMuted = !localVoice().muted

  if (!newMuted && localVoice().deafened) {
    playSound("undeafen")
  } else {
    playSound(newMuted ? "mute" : "unmute")
  }

  if (!newMuted && localVoice().deafened) {
    setLocalVoice((prev) => ({ ...prev, muted: false, deafened: false }))
    updateUser(currentUser.id, { voiceMuted: false, voiceDeafened: false })
    webrtcManager.setVoiceState(false, false)
  } else {
    setLocalVoice((prev) => ({ ...prev, muted: newMuted }))
    updateUser(currentUser.id, { voiceMuted: newMuted })
    webrtcManager.setMuted(newMuted)
  }
}

/**
 * Toggle deafen state
 */
export function toggleDeafen(currentUser: User | null): void {
  if (!localVoice().inVoice || !currentUser) return

  const newDeafened = !localVoice().deafened
  playSound(newDeafened ? "deafen" : "undeafen")

  if (newDeafened) {
    setLocalVoice((prev) => ({ ...prev, muted: true, deafened: true }))
    updateUser(currentUser.id, { voiceMuted: true, voiceDeafened: true })
    webrtcManager.setVoiceState(true, true)
  } else {
    setLocalVoice((prev) => ({ ...prev, muted: false, deafened: false }))
    updateUser(currentUser.id, { voiceMuted: false, voiceDeafened: false })
    webrtcManager.setVoiceState(false, false)
  }
}

/**
 * Stop voice (cleanup on disconnect)
 */
export function stopVoice(): void {
  if (localVoice().inVoice) {
    webrtcManager.stop()
    setLocalVoice({
      inVoice: false,
      muted: false,
      deafened: false
    })
  }
}
