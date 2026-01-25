import { createSignal } from "solid-js"
import type { Session, User } from "../../../shared/types"
import { getUsers } from "../lib/api/auth"
import { createLogger } from "../lib/logger"
import { webrtcManager } from "../lib/webrtc"
import { type ReadyPayload, wsManager } from "../lib/ws"
import {
  clearTypingUsers,
  getTypingUsers,
  sendTyping as sendTypingIndicator,
  setupTypingListeners
} from "./typing"
import { addUsers, removeUser, updateUser } from "./users"
import {
  joinVoice as doJoinVoice,
  leaveVoice as doLeaveVoice,
  toggleDeafen as doToggleDeafen,
  toggleMute as doToggleMute,
  getLocalVoice,
  rejoinVoice,
  setupVoiceListeners,
  stopVoice
} from "./voice"

const log = createLogger("Session")

export interface WSStatusCallbacks {
  onConnected: () => void
  onServerUnavailable: () => void
}

// Session state
const [session, setSession] = createSignal<Session | null>(null)

// Store WebSocket event listener cleanup functions
let wsUnsubscribes: (() => void)[] = []

// Module-level user accessor, set by connectWS
let _getCurrentUser: () => User | null = () => null

// Track voice state across reconnections
let wasInVoice = false
let voiceStateBeforeDisconnect = { muted: false, deafened: false }

// Set up WebSocket event listeners
function setupWSListeners(callbacks: WSStatusCallbacks): (() => void)[] {
  const unsubscribes: (() => void)[] = []

  unsubscribes.push(
    wsManager.on("ready", (payload: ReadyPayload) => {
      payload.members.forEach((member) => {
        updateUser(member.id, {
          status: member.status,
          inVoice: member.in_voice ?? false,
          voiceMuted: member.muted ?? false,
          voiceDeafened: member.deafened ?? false,
          voiceSpeaking: false,
          createdAt: member.created_at
        })
      })
    })
  )

  unsubscribes.push(
    wsManager.on("presence_update", (payload) => {
      updateUser(payload.user_id, { status: payload.status })
    })
  )

  unsubscribes.push(
    wsManager.on("user_joined", (payload) => {
      const { member } = payload
      addUsers([
        {
          id: member.id,
          username: member.username,
          avatarUrl: member.avatar_url,
          status: member.status,
          inVoice: member.in_voice ?? false,
          voiceMuted: member.muted ?? false,
          voiceDeafened: member.deafened ?? false,
          voiceSpeaking: false,
          createdAt: member.created_at
        }
      ])
    })
  )

  unsubscribes.push(
    wsManager.on("user_left", (payload) => {
      removeUser(payload.user_id)
    })
  )

  unsubscribes.push(
    wsManager.on("user_update", (payload) => {
      updateUser(payload.id, {
        username: payload.username || "",
        avatarUrl: payload.avatar_url
      })
    })
  )

  unsubscribes.push(
    wsManager.on("disconnected", () => {
      const voiceState = getLocalVoice()()
      if (voiceState.inVoice) {
        wasInVoice = true
        voiceStateBeforeDisconnect = { muted: voiceState.muted, deafened: voiceState.deafened }
      }
      stopVoice()
      webrtcManager.stop()

      const currentSession = session()
      if (currentSession) {
        setSession({
          ...currentSession,
          status: wsManager.getState() === "reconnecting" ? "connecting" : "disconnected"
        })
      }
    })
  )

  unsubscribes.push(
    wsManager.on("server_unavailable", () => {
      callbacks.onServerUnavailable()
      const currentSession = session()
      if (currentSession) {
        setSession({ ...currentSession, status: "disconnected" })
      }
    })
  )

  unsubscribes.push(
    wsManager.on("connected", () => {
      const currentSession = session()
      callbacks.onConnected()
      if (currentSession) {
        setSession({ ...currentSession, status: "connected", connectedAt: Date.now() })
      }

      if (wasInVoice) {
        wasInVoice = false
        const { muted, deafened } = voiceStateBeforeDisconnect
        rejoinVoice(_getCurrentUser(), muted, deafened)
      }
    })
  )

  unsubscribes.push(...setupTypingListeners(_getCurrentUser))
  unsubscribes.push(...setupVoiceListeners(_getCurrentUser))

  return unsubscribes
}

/**
 * Connect WebSocket to a server. Called by connection store after auth is validated.
 */
export async function connectWS(
  serverId: string,
  url: string,
  token: string,
  callbacks: WSStatusCallbacks,
  getCurrentUser: () => User | null
): Promise<void> {
  _getCurrentUser = getCurrentUser

  // Fetch users before connecting
  try {
    const allUsers = await getUsers(url, token)
    const usersWithDefaults = allUsers.map((user) => ({
      ...user,
      status: "offline" as const,
      inVoice: false,
      voiceMuted: false,
      voiceDeafened: false,
      voiceSpeaking: false
    }))
    addUsers(usersWithDefaults)
  } catch (err) {
    log.error("Failed to fetch users:", err)
  }

  // Set up listeners and connect
  const unsubscribes = setupWSListeners(callbacks)
  try {
    await wsManager.connect(url, token)
    wsUnsubscribes = unsubscribes
  } catch (err) {
    for (const unsub of unsubscribes) unsub()
    throw err
  }

  setSession({ serverId, status: "connected", connectedAt: Date.now() })
}

/**
 * Disconnect WebSocket and clean up. Called by connection store.
 */
export function disconnectWS(): void {
  wasInVoice = false
  stopVoice()
  webrtcManager.stop()
  for (const unsub of wsUnsubscribes) unsub()
  wsUnsubscribes = []
  wsManager.disconnect()
  clearTypingUsers()
  setSession(null)
}

export function useSession() {
  const joinVoice = (): void => {
    const currentSession = session()
    if (!currentSession || currentSession.status !== "connected") return
    doJoinVoice(_getCurrentUser(), true)
  }

  const leaveVoice = (): void => {
    doLeaveVoice(_getCurrentUser())
  }

  const toggleMute = (): void => {
    doToggleMute(_getCurrentUser())
  }

  const toggleDeafen = (): void => {
    doToggleDeafen(_getCurrentUser())
  }

  const sendTyping = (): void => {
    sendTypingIndicator(session()?.status === "connected")
  }

  const setPresence = (status: "online" | "idle" | "dnd" | "offline"): void => {
    if (session()?.status === "connected") {
      wsManager.setPresence(status)
    }
  }

  return {
    session,
    localVoice: getLocalVoice(),
    typingUsers: getTypingUsers(),
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleDeafen,
    sendTyping,
    setPresence
  }
}
