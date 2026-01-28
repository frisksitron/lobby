import { batch, createRoot, createSignal, useTransition } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import type { LocalVoiceState, Server, Session, TypingUser, User } from "../../../shared/types"
import { getMe as apiGetMe, getUsers } from "../lib/api/auth"
import type { ServerInfo } from "../lib/api/types"
import { ApiError } from "../lib/api/types"
import {
  clearSession as clearTokenSession,
  getValidToken,
  hasStoredSession,
  setServerUrl as setTokenManagerServerUrl
} from "../lib/auth/token-manager"
import { TYPING_TIMEOUT_MS } from "../lib/constants/ui"
import { createLogger } from "../lib/logger"
import { playSound } from "../lib/sounds"
import { clearAllAuthData, setTokens } from "../lib/storage"
import { audioManager, preloadWasm, warmupWebRTC, webrtcManager } from "../lib/webrtc"
import {
  type ErrorPayload,
  type ReadyPayload,
  type RtcReadyPayload,
  type VoiceSpeakingPayload,
  wsManager
} from "../lib/ws"

const log = createLogger("Core")

type ConnectionStatus =
  | "initializing"
  | "disconnected"
  | "connecting"
  | "connected"
  | "needs_auth"
  | "server_unavailable"

interface ServerConnection {
  url: string
  id: string
  name: string
  info?: ServerInfo
}

const [status, setStatus] = createSignal<ConnectionStatus>("initializing")
const [currentServer, setCurrentServer] = createSignal<ServerConnection | null>(null)
const [currentUserId, setCurrentUserId] = createSignal<string | null>(null)
const [servers, setServers] = createSignal<Server[]>([])
const [session, setSession] = createSignal<Session | null>(null)
const [localVoice, setLocalVoice] = createSignal<LocalVoiceState>({
  connecting: false,
  inVoice: false,
  muted: false,
  deafened: false
})
const [typingUsers, setTypingUsers] = createSignal<TypingUser[]>([])
const [users, setUsers] = createStore<Record<string, User>>({})
const [isServerSwitching, startServerTransition] = createRoot(() => useTransition())

let wsUnsubscribes: (() => void)[] = []
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryAttempt = 0
const RETRY_DELAYS = [2, 5, 10, 30]

let wasInVoice = false
let voiceStateBeforeDisconnect = { muted: false, deafened: false }
let confirmedMuted = false
let confirmedDeafened = false

const typingTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

function addUser(user: User): void {
  setUsers(user.id, user)
}

function addUsers(usersToAdd: User[]): void {
  if (usersToAdd.length === 0) return
  setUsers(
    produce((state) => {
      for (const user of usersToAdd) {
        state[user.id] = user
      }
    })
  )
}

function updateUser(userId: string, updates: Partial<User>): void {
  if (!users[userId]) return
  setUsers(
    userId,
    produce((user) => {
      Object.assign(user, updates)
    })
  )
}

function removeUser(userId: string): void {
  setUsers(
    produce((state) => {
      delete state[userId]
    })
  )
}

function clearUsers(): void {
  setUsers(reconcile({}))
}

function handleTypingStart(payload: {
  user_id: string
  username: string
  timestamp: string
}): void {
  const userId = currentUserId()
  if (userId && payload.user_id === userId) return

  const existing = typingTimeouts.get(payload.user_id)
  if (existing) clearTimeout(existing)

  setTypingUsers((prev) => {
    if (prev.some((u) => u.userId === payload.user_id)) return prev
    return [
      ...prev,
      { userId: payload.user_id, username: payload.username, timestamp: payload.timestamp }
    ]
  })

  typingTimeouts.set(
    payload.user_id,
    setTimeout(() => {
      setTypingUsers((prev) => prev.filter((u) => u.userId !== payload.user_id))
      typingTimeouts.delete(payload.user_id)
    }, TYPING_TIMEOUT_MS)
  )
}

function handleTypingStop(payload: { user_id: string }): void {
  const timeout = typingTimeouts.get(payload.user_id)
  if (timeout) {
    clearTimeout(timeout)
    typingTimeouts.delete(payload.user_id)
  }
  setTypingUsers((prev) => prev.filter((u) => u.userId !== payload.user_id))
}

function clearTypingUsers(): void {
  for (const timeout of typingTimeouts.values()) clearTimeout(timeout)
  typingTimeouts.clear()
  setTypingUsers([])
}

function handleVoiceStateUpdate(payload: {
  user_id: string
  in_voice: boolean
  muted: boolean
  deafened: boolean
}): void {
  const userId = currentUserId()
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
      // Just update muted/deafened to match server confirmation
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

async function handleRtcReady(payload: RtcReadyPayload): Promise<void> {
  log.info("RTC ready, starting WebRTC")

  const iceServers: RTCIceServer[] = (payload.ice_servers ?? []).map((server) => ({
    urls: server.urls,
    username: server.username,
    credential: server.credential
  }))

  const userId = currentUserId()
  const voice = localVoice()

  try {
    await webrtcManager.start(iceServers)

    // Apply initial mute/deafen state now that streams are ready
    if (voice.muted || voice.deafened) {
      webrtcManager.setVoiceState(voice.muted, voice.deafened)
    }

    // Now mark as fully connected
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
      const id = currentUserId()
      if (id) {
        updateUser(id, { voiceSpeaking: speaking })
      }
    })
  } catch (err) {
    log.error("Failed to start WebRTC:", err)
    setLocalVoice({ connecting: false, inVoice: false, muted: false, deafened: false })
  }
}

function handleVoiceSpeaking(payload: VoiceSpeakingPayload): void {
  updateUser(payload.user_id, { voiceSpeaking: payload.speaking })
}

function stopVoice(): void {
  const voice = localVoice()
  if (voice.inVoice || voice.connecting) {
    webrtcManager.stop()
    setLocalVoice({ connecting: false, inVoice: false, muted: false, deafened: false })
  }
}

function joinVoice(): void {
  const userId = currentUserId()
  if (!userId || session()?.status !== "connected") return

  setLocalVoice({ connecting: true, inVoice: false, muted: false, deafened: false })
  wsManager.joinVoice(false, false)
}

function rejoinVoice(muted: boolean, deafened: boolean): void {
  const userId = currentUserId()
  if (!userId) return

  setLocalVoice({ connecting: true, inVoice: false, muted, deafened })
  wsManager.joinVoice(muted, deafened)
}

function leaveVoice(): void {
  setLocalVoice({ connecting: false, inVoice: false, muted: false, deafened: false })

  const userId = currentUserId()
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

function toggleMute(): void {
  const userId = currentUserId()
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

function toggleDeafen(): void {
  const userId = currentUserId()
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

function setupWSListeners(): (() => void)[] {
  const unsubscribes: (() => void)[] = []

  unsubscribes.push(
    wsManager.on("ready", (payload: ReadyPayload) => {
      // Preload noise suppression WASM and warm up WebRTC so voice join is fast
      preloadWasm()
      warmupWebRTC()

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
      const voiceState = localVoice()
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
      setStatus("server_unavailable")
      const currentSession = session()
      if (currentSession) {
        setSession({ ...currentSession, status: "disconnected" })
      }
    })
  )

  unsubscribes.push(
    wsManager.on("connected", () => {
      const currentSession = session()
      setStatus("connected")
      if (currentSession) {
        setSession({ ...currentSession, status: "connected", connectedAt: Date.now() })
      }

      if (wasInVoice) {
        wasInVoice = false
        const { muted, deafened } = voiceStateBeforeDisconnect
        rejoinVoice(muted, deafened)
      }
    })
  )

  unsubscribes.push(
    wsManager.on("typing_start", (payload) => {
      handleTypingStart(payload)
    })
  )

  unsubscribes.push(
    wsManager.on("typing_stop", (payload) => {
      handleTypingStop(payload)
    })
  )

  unsubscribes.push(
    wsManager.on("voice_state_update", (payload) => {
      handleVoiceStateUpdate(payload)
    })
  )

  unsubscribes.push(
    wsManager.on("rtc_ready", (payload: RtcReadyPayload) => {
      handleRtcReady(payload)
    })
  )

  unsubscribes.push(
    wsManager.on("voice_speaking", (payload: VoiceSpeakingPayload) => {
      handleVoiceSpeaking(payload)
    })
  )

  unsubscribes.push(
    wsManager.on("server_error", (payload: ErrorPayload) => {
      const userId = currentUserId()

      if (payload.code === "VOICE_STATE_COOLDOWN") {
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
        }
      } else if (payload.code === "VOICE_JOIN_COOLDOWN") {
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
    })
  )

  return unsubscribes
}

async function connectWS(serverId: string, url: string, token: string): Promise<void> {
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

  const unsubscribes = setupWSListeners()
  try {
    await wsManager.connect(url, token)
    wsUnsubscribes = unsubscribes
  } catch (err) {
    for (const unsub of unsubscribes) unsub()
    throw err
  }

  setSession({ serverId, status: "connected", connectedAt: Date.now() })
}

function disconnectWS(): void {
  wasInVoice = false
  stopVoice()
  webrtcManager.stop()
  for (const unsub of wsUnsubscribes) unsub()
  wsUnsubscribes = []
  wsManager.disconnect()
  clearTypingUsers()
  setSession(null)
}

function getServerIdFromUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function scheduleRetry(serverId: string): void {
  if (retryTimer) clearTimeout(retryTimer)
  const delay = RETRY_DELAYS[Math.min(retryAttempt, RETRY_DELAYS.length - 1)]
  retryTimer = setTimeout(async () => {
    retryAttempt++
    const success = await connectToServer(serverId)
    if (!success && status() === "server_unavailable") {
      scheduleRetry(serverId)
    }
  }, delay * 1000)
}

async function loadServers(): Promise<void> {
  try {
    const storedServers = await window.api.servers.getAll()
    const serverList: Server[] = storedServers.map((entry) => ({
      id: entry.id,
      name: entry.name,
      iconUrl: entry.iconUrl,
      ownerId: "",
      memberIds: []
    }))
    setServers(serverList)
  } catch (error) {
    log.error("Failed to load servers from storage:", error)
  }
}

async function initialize(): Promise<void> {
  setStatus("initializing")

  try {
    await loadServers()
    const settings = await window.api.settings.getAll()
    const serverList = servers()

    if (serverList.length === 0) {
      setStatus("disconnected")
      return
    }

    const lastServer = settings.lastActiveServerId
      ? serverList.find((s) => s.id === settings.lastActiveServerId)
      : serverList[0]

    if (!lastServer) {
      setStatus("disconnected")
      return
    }

    const success = await connectToServer(lastServer.id)
    if (!success && status() === "server_unavailable") {
      retryAttempt = 0
      scheduleRetry(lastServer.id)
    }
  } catch {
    setStatus("disconnected")
  }
}

async function connectToServer(serverId: string): Promise<boolean> {
  if (currentServer()?.id === serverId && status() === "connected") {
    return true
  }

  const storedServers = await window.api.servers.getAll()
  const server = storedServers.find((s) => s.id === serverId)
  if (!server) return false

  disconnectWS()
  setTokenManagerServerUrl(server.url)
  setCurrentServer({ url: server.url, id: server.id, name: server.name })
  setStatus("connecting")
  const hasSession = await hasStoredSession(server.url)

  if (!hasSession) {
    setStatus("needs_auth")
    return false
  }

  const token = await getValidToken()
  if (!token) {
    const stillHasSession = await hasStoredSession(server.url)
    setStatus(stillHasSession ? "server_unavailable" : "needs_auth")
    return false
  }

  try {
    const user = await apiGetMe(server.url, token)
    setCurrentUserId(user.id)
    addUser(user)
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setStatus("needs_auth")
    } else {
      setStatus("server_unavailable")
    }
    return false
  }

  try {
    await connectWS(serverId, server.url, token)
    setStatus("connected")
    await window.api.settings.set("lastActiveServerId", serverId)
    return true
  } catch {
    setStatus("server_unavailable")
    return false
  }
}

async function onAuthSuccess(
  user: User,
  serverUrl: string,
  serverInfo: ServerInfo | null,
  tokens: { accessToken: string; refreshToken: string; expiresAt: string }
): Promise<void> {
  const serverId = getServerIdFromUrl(serverUrl)

  await setTokens(serverId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt)
  setTokenManagerServerUrl(serverUrl)

  batch(() => {
    setCurrentServer({
      url: serverUrl,
      id: serverId,
      name: serverInfo?.name || "Server",
      info: serverInfo || undefined
    })
    setCurrentUserId(user.id)
    addUser(user)
  })

  await addServerEntry({
    id: serverId,
    name: serverInfo?.name || "Server",
    url: serverUrl,
    email: user.email
  })

  try {
    await connectWS(serverId, serverUrl, tokens.accessToken)
    setStatus("connected")
    await window.api.settings.set("lastActiveServerId", serverId)
  } catch {
    setStatus("needs_auth")
  }
}

function triggerAddServer(): void {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  disconnectWS()
  batch(() => {
    setCurrentServer(null)
    setCurrentUserId(null)
    setStatus("disconnected")
  })
}

function triggerReauth(): void {
  disconnectWS()
  setStatus("needs_auth")
}

async function logout(): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  disconnectWS()
  await clearTokenSession()
  clearUsers()
  batch(() => {
    setCurrentUserId(null)
    setStatus("needs_auth")
  })
}

async function disconnect(): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  disconnectWS()
  await clearTokenSession()
  await clearAllAuthData()
  clearUsers()
  batch(() => {
    setCurrentUserId(null)
    setCurrentServer(null)
    setStatus("disconnected")
  })
}

function getServerUrl(): string | null {
  return currentServer()?.url || null
}

function updateCurrentUser(updates: Partial<User>): void {
  const userId = currentUserId()
  if (userId) {
    // Only update profile fields from API responses, not session state
    const profileUpdates: Partial<User> = {}
    if (updates.username !== undefined) profileUpdates.username = updates.username
    if (updates.avatarUrl !== undefined) profileUpdates.avatarUrl = updates.avatarUrl
    if (updates.email !== undefined) profileUpdates.email = updates.email
    updateUser(userId, profileUpdates)
  }
}

async function addServerEntry(serverInfo: {
  id: string
  name: string
  url: string
  iconUrl?: string
  email?: string
}): Promise<void> {
  const existing = servers().find((s) => s.id === serverInfo.id)
  if (existing) {
    await window.api.servers.add(serverInfo)
    return
  }

  const newServer: Server = {
    id: serverInfo.id,
    name: serverInfo.name,
    iconUrl: serverInfo.iconUrl,
    ownerId: "",
    memberIds: []
  }
  setServers((prev) => [...prev, newServer])
  await window.api.servers.add({
    id: serverInfo.id,
    name: serverInfo.name,
    url: serverInfo.url,
    iconUrl: serverInfo.iconUrl
  })
}

function setActiveServer(serverId: string): void {
  if (currentServer()?.id === serverId) return
  startServerTransition(async () => {
    await window.api.settings.set("lastActiveServerId", serverId)
    await connectToServer(serverId)
  })
}

async function leaveServer(serverId: string): Promise<void> {
  const currentServers = servers()
  const newServers = currentServers.filter((s) => s.id !== serverId)
  setServers(newServers)
  await window.api.servers.remove(serverId)

  if (currentServer()?.id === serverId) {
    if (newServers.length > 0) {
      setActiveServer(newServers[0].id)
    } else {
      await disconnect()
    }
  }
}

function sendTyping(): void {
  if (session()?.status === "connected") {
    wsManager.sendTyping()
  }
}

function setPresence(presenceStatus: "online" | "idle" | "dnd" | "offline"): void {
  if (session()?.status === "connected") {
    wsManager.setPresence(presenceStatus)
  }
}

export function useConnection() {
  return {
    status,
    currentServer,
    currentUser: () => {
      const userId = currentUserId()
      return userId ? users[userId] : null
    },
    isInitializing: () => status() === "initializing",
    needsAuth: () => status() === "needs_auth",
    isConnected: () => status() === "connected",
    isServerUnavailable: () => status() === "server_unavailable",
    connectionState: status,
    initialize,
    connectToServer,
    onAuthSuccess,
    triggerAddServer,
    triggerReauth,
    logout,
    disconnect,
    getServerUrl,
    updateCurrentUser
  }
}

export function useServers() {
  return {
    servers,
    activeServerId: () => currentServer()?.id ?? "",
    activeServer: () => servers().find((s) => s.id === currentServer()?.id),
    setActiveServer,
    leaveServer,
    isServerSwitching
  }
}

export function useSession() {
  return {
    session,
    localVoice,
    typingUsers,
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleDeafen,
    sendTyping,
    setPresence
  }
}

export function useUsers() {
  return {
    users: () => users,
    getUserById: (id: string) => users[id],
    getAllUsers: () => Object.values(users)
  }
}

// Direct exports for use outside of reactive components (e.g., in stores)
export { getServerUrl }
export function getCurrentUser(): User | null {
  const userId = currentUserId()
  return userId ? users[userId] : null
}
