/**
 * Connection Store - Orchestrates server connections and server list
 *
 * Single entry point for all connection changes:
 * - connectToServer(serverId) - validates tokens, fetches user, connects WS
 * - onAuthSuccess() - stores tokens then connects
 * - triggerAddServer() - shows fresh auth flow
 * - logout() - clears tokens, shows auth
 *
 * Also owns the server list (merged from servers.ts):
 * - servers signal, addServer, leaveServer, setActiveServer
 */

import { createSignal } from "solid-js"
import type { Server, User } from "../../../shared/types"
import { getMe as apiGetMe } from "../lib/api/auth"
import type { ServerInfo } from "../lib/api/types"
import { ApiError } from "../lib/api/types"
import {
  clearSession as clearTokenSession,
  getValidToken,
  hasStoredSession,
  setServerUrl as setTokenManagerServerUrl
} from "../lib/auth/token-manager"
import { createLogger } from "../lib/logger"
import { clearAllAuthData, setTokens } from "../lib/storage"
import type { WSStatusCallbacks } from "./session"
import { connectWS, disconnectWS } from "./session"
import { addUser, clearUsers } from "./users"

const log = createLogger("Connection")

type Status =
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

const [status, setStatus] = createSignal<Status>("initializing")
const [currentServer, setCurrentServer] = createSignal<ServerConnection | null>(null)
const [currentUser, setCurrentUser] = createSignal<User | null>(null)
const [servers, setServers] = createSignal<Server[]>([])

const needsAuth = () => status() === "needs_auth"
const isConnected = () => status() === "connected"
const isInitializing = () => status() === "initializing"
const isServerUnavailable = () => status() === "server_unavailable"
const activeServerId = () => currentServer()?.id || ""

const wsCallbacks: WSStatusCallbacks = {
  onConnected: () => setStatus("connected"),
  onServerUnavailable: () => setStatus("server_unavailable")
}

function getServerIdFromUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

let retryTimer: ReturnType<typeof setTimeout> | null = null
const RETRY_DELAYS = [2, 5, 10, 30]
let retryAttempt = 0

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

/**
 * Load servers from persistent storage into the signal.
 */
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

/**
 * Initialize on app start. Loads servers and tries to connect to last active.
 */
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

/**
 * Connect to a server. Validates tokens, fetches user info, connects WebSocket.
 * If tokens are missing/invalid, sets needs_auth so AuthView shows.
 */
async function connectToServer(serverId: string): Promise<boolean> {
  if (currentServer()?.id === serverId && isConnected()) {
    return true
  }

  const storedServers = await window.api.servers.getAll()
  const server = storedServers.find((s) => s.id === serverId)
  if (!server) return false

  disconnectWS()
  setCurrentServer({ url: server.url, id: server.id, name: server.name })
  setStatus("connecting")

  setTokenManagerServerUrl(server.url)
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
    setCurrentUser(user)
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
    await connectWS(serverId, server.url, token, wsCallbacks, () => currentUser())
    setStatus("connected")
    await window.api.settings.set("lastActiveServerId", serverId)
    return true
  } catch {
    setStatus("server_unavailable")
    return false
  }
}

/**
 * Called after successful authentication.
 */
async function onAuthSuccess(
  user: User,
  serverUrl: string,
  serverInfo: ServerInfo | null,
  tokens: { accessToken: string; refreshToken: string; expiresAt: string }
): Promise<void> {
  const serverId = getServerIdFromUrl(serverUrl)

  await setTokens(serverId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt)
  setTokenManagerServerUrl(serverUrl)

  setCurrentServer({
    url: serverUrl,
    id: serverId,
    name: serverInfo?.name || "Server",
    info: serverInfo || undefined
  })
  setCurrentUser(user)
  addUser(user)

  await addServerEntry({
    id: serverId,
    name: serverInfo?.name || "Server",
    url: serverUrl,
    email: user.email
  })

  try {
    await connectWS(serverId, serverUrl, tokens.accessToken, wsCallbacks, () => currentUser())
    setStatus("connected")
    await window.api.settings.set("lastActiveServerId", serverId)
  } catch {
    setStatus("needs_auth")
  }
}

/**
 * Start fresh auth flow for adding a new server.
 */
function triggerAddServer(): void {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  disconnectWS()
  setCurrentServer(null)
  setCurrentUser(null)
  setStatus("disconnected")
}

/**
 * Trigger re-auth for current server (e.g., token expired during use).
 */
function triggerReauth(): void {
  disconnectWS()
  setStatus("needs_auth")
}

/**
 * Logout from current server.
 */
async function logout(): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  disconnectWS()
  await clearTokenSession()
  clearUsers()
  setCurrentUser(null)
  setStatus("needs_auth")
}

/**
 * Fully disconnect and clear everything.
 */
async function disconnect(): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  disconnectWS()
  await clearTokenSession()
  await clearAllAuthData()
  clearUsers()
  setCurrentUser(null)
  setCurrentServer(null)
  setStatus("disconnected")
}

/**
 * Get the current server URL (used by other modules).
 */
function getServerUrl(): string | null {
  return currentServer()?.url || null
}

/**
 * Update current user data.
 */
function updateCurrentUser(updates: Partial<User>): void {
  const user = currentUser()
  if (user) {
    const updated = { ...user, ...updates }
    setCurrentUser(updated)
    addUser(updated)
  }
}

/**
 * Add or update a server entry in the list and persist.
 */
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

/**
 * Switch to a different server.
 */
async function setActiveServer(serverId: string): Promise<void> {
  if (activeServerId() === serverId) return
  await window.api.settings.set("lastActiveServerId", serverId)
  await connectToServer(serverId)
}

/**
 * Leave a server: remove from list, switch or disconnect.
 */
async function leaveServer(serverId: string): Promise<void> {
  const currentServers = servers()
  const newServers = currentServers.filter((s) => s.id !== serverId)
  setServers(newServers)
  await window.api.servers.remove(serverId)

  if (activeServerId() === serverId) {
    if (newServers.length > 0) {
      await setActiveServer(newServers[0].id)
    } else {
      await disconnect()
    }
  }
}

export function useConnection() {
  return {
    status,
    currentServer,
    currentUser,
    isInitializing,
    needsAuth,
    isConnected,
    isServerUnavailable,
    connectionState: status,
    setConnectionState: setStatus,
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
  const activeServer = () => servers().find((s) => s.id === activeServerId())

  return {
    servers,
    activeServerId,
    activeServer,
    setActiveServer,
    leaveServer
  }
}

export { currentUser, getServerUrl, updateCurrentUser }
