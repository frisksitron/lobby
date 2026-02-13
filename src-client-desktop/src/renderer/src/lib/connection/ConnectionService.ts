import { type Accessor, batch, createSignal, type Setter } from "solid-js"
import type { User } from "../../../../shared/types"
import { getMe as apiGetMe } from "../api/auth"
import type { ServerInfo } from "../api/types"
import { ApiError } from "../api/types"
import {
  clearSession as clearTokenSession,
  getValidToken,
  hasStoredSession,
  setServerUrl as setTokenManagerServerUrl,
  startAutoRefresh as startTokenAutoRefresh,
  stopAutoRefresh as stopTokenAutoRefresh
} from "../auth/token-manager"
import { createLogger } from "../logger"
import { clearAllAuthData, setTokens } from "../storage"
import { preloadWasm, warmupWebRTC, webrtcManager } from "../webrtc"
import { wsManager } from "../ws"
import type {
  ErrorPayload,
  ReadyPayload,
  RtcReadyPayload,
  VoiceSpeakingPayload,
  WSClientEvents,
  WSClientEventType
} from "../ws/types"
import { DEFAULT_RETRY_CONFIG, RetryStrategy } from "./RetryStrategy"
import {
  type ConnectionDetail,
  type ConnectionPhase,
  DEFAULT_CONNECTION_DETAIL,
  type ServerConnection
} from "./types"

const log = createLogger("ConnectionService")

type EventCallback<T> = (data: T) => void

interface Session {
  serverId: string
  status: "connecting" | "connected"
  connectedAt?: number
}

// Lifecycle event types emitted by ConnectionService
export type LifecycleEventType = "users_clear" | "typing_clear" | "voice_stop"

interface Resolvers {
  getUserById: (userId: string) => User | undefined
  onUserAdd: (users: User[]) => void
  onUserUpdate: (userId: string, updates: Partial<User>) => void
  onUserRemove: (userId: string) => void
  addServerEntry: (entry: { id: string; name: string; url: string; email: string }) => Promise<void>
}

class ConnectionService {
  // Reactive signals
  private phase: Accessor<ConnectionPhase>
  private setPhase: Setter<ConnectionPhase>
  private currentServer: Accessor<ServerConnection | null>
  private setCurrentServer: Setter<ServerConnection | null>
  private currentUserId: Accessor<string | null>
  private setCurrentUserId: Setter<string | null>
  private session: Accessor<Session | null>
  private setSession: Setter<Session | null>
  private connectionVersion: Accessor<number>
  private setConnectionVersion: Setter<number>
  private connectionDetail: Accessor<ConnectionDetail>
  private setConnectionDetail: Setter<ConnectionDetail>

  // Retry strategy
  private retry: RetryStrategy

  // WS event unsubscribes
  private wsUnsubscribes: (() => void)[] = []

  // External event listeners (WS events forwarded to stores)
  private listeners = new Map<WSClientEventType, Set<EventCallback<unknown>>>()

  // Lifecycle event listeners
  private lifecycleListeners = new Map<LifecycleEventType, Set<() => void>>()

  // Data resolvers
  private resolvers: Resolvers | null = null

  // Concurrency guard: incremented on each connection attempt, checked after awaits
  private connectGeneration = 0

  // Set when server sends invalid_session (duplicate login eviction)
  private sessionReplaced = false

  constructor() {
    // Initialize signals
    const [phase, setPhase] = createSignal<ConnectionPhase>("disconnected")
    this.phase = phase
    this.setPhase = setPhase

    const [currentServer, setCurrentServer] = createSignal<ServerConnection | null>(null)
    this.currentServer = currentServer
    this.setCurrentServer = setCurrentServer

    const [currentUserId, setCurrentUserId] = createSignal<string | null>(null)
    this.currentUserId = currentUserId
    this.setCurrentUserId = setCurrentUserId

    const [session, setSession] = createSignal<Session | null>(null)
    this.session = session
    this.setSession = setSession

    const [connectionVersion, setConnectionVersion] = createSignal(0)
    this.connectionVersion = connectionVersion
    this.setConnectionVersion = setConnectionVersion

    const [connectionDetail, setConnectionDetail] =
      createSignal<ConnectionDetail>(DEFAULT_CONNECTION_DETAIL)
    this.connectionDetail = connectionDetail
    this.setConnectionDetail = setConnectionDetail

    // Initialize retry strategy
    this.retry = new RetryStrategy({
      ...DEFAULT_RETRY_CONFIG,
      onAttempt: (attempt, delay) => {
        this.setConnectionDetail({
          status: "reconnecting",
          reason: "ws_closed",
          message: `Connection lost. Reconnecting... (attempt ${attempt + 1}/${this.retry.getMaxAttempts()})`,
          since: Date.now(),
          reconnectAttempt: attempt,
          maxReconnectAttempts: this.retry.getMaxAttempts(),
          countdownSeconds: delay
        })
      },
      onMaxRetries: (_attempt, maxAttempts) => {
        this.setPhase("failed")
        this.setConnectionDetail({
          status: "unavailable",
          reason: "server_error",
          message: `Unable to connect after ${maxAttempts} attempts.`,
          since: Date.now(),
          reconnectAttempt: maxAttempts,
          maxReconnectAttempts: maxAttempts
        })
      }
    })

    // Defer reactive listeners
    queueMicrotask(() => this.setupNetworkListener())
  }

  // Public accessors
  getPhase = (): ConnectionPhase => this.phase()
  getServer = (): ServerConnection | null => this.currentServer()
  getUserId = (): string | null => this.currentUserId()
  getSession = (): Session | null => this.session()
  getConnectionVersion = (): number => this.connectionVersion()
  getConnectionDetail = (): ConnectionDetail => this.connectionDetail()
  getCountdown = (): number | null => this.retry.getCountdown()

  // Register data resolvers (called once from connection store)
  setResolvers(resolvers: Resolvers): void {
    this.resolvers = resolvers
  }

  private setupNetworkListener(): void {
    wsManager.on("network_status_change", ({ online }) => {
      if (!online) {
        this.setConnectionDetail({
          status: "offline",
          reason: "browser_offline",
          message: "You're offline. Check your internet connection.",
          since: Date.now()
        })
      } else if (this.phase() === "connected") {
        this.setConnectionDetail({
          status: "healthy",
          reason: "none",
          message: "",
          since: Date.now()
        })
      } else if (
        this.phase() !== "connected" &&
        this.connectionDetail().reason === "browser_offline" &&
        this.currentServer()?.id
      ) {
        const serverId = this.currentServer()?.id
        if (!serverId) {
          return
        }

        this.retry.cancel()
        this.setConnectionDetail({
          status: "reconnecting",
          reason: "ws_closed",
          message: "Connection restored. Reconnecting...",
          since: Date.now(),
          reconnectAttempt: 0,
          maxReconnectAttempts: this.retry.getMaxAttempts()
        })
        this.scheduleRetry(serverId)
      }
    })
  }

  private setAuthExpiredState(message: string): void {
    stopTokenAutoRefresh()
    this.setPhase("needs_auth")
    this.setConnectionDetail({
      status: "unavailable",
      reason: "auth_expired",
      message,
      since: Date.now()
    })
  }

  private classifyDisconnectReason():
    | "browser_offline"
    | "auth_expired"
    | "protocol_mismatch"
    | "server_error" {
    if (!wsManager.getIsOnline()) {
      return "browser_offline"
    }

    const serverError = wsManager.getLastServerError()
    if (serverError?.code === "AUTH_FAILED" || serverError?.code === "AUTH_EXPIRED") {
      return "auth_expired"
    }

    if (serverError?.code === "PROTOCOL_MISMATCH") {
      return "protocol_mismatch"
    }

    const disconnectInfo = wsManager.getLastDisconnectInfo()
    if (
      disconnectInfo?.serverErrorCode === "AUTH_FAILED" ||
      disconnectInfo?.serverErrorCode === "AUTH_EXPIRED" ||
      disconnectInfo?.code === 1008 ||
      disconnectInfo?.code === 4001
    ) {
      return "auth_expired"
    }

    if (disconnectInfo?.serverErrorCode === "PROTOCOL_MISMATCH") {
      return "protocol_mismatch"
    }

    return "server_error"
  }

  private applyConnectionFailureClassification(defaultMessage: string): void {
    const reason = this.classifyDisconnectReason()

    if (reason === "browser_offline") {
      this.setPhase("failed")
      this.setConnectionDetail({
        status: "offline",
        reason: "browser_offline",
        message: "You're offline. Check your internet connection.",
        since: Date.now()
      })
      return
    }

    if (reason === "auth_expired") {
      this.setAuthExpiredState("Session expired. Sign in to continue.")
      return
    }

    if (reason === "protocol_mismatch") {
      const mismatchMessage =
        wsManager.getLastServerError()?.message ||
        "Client/server protocol mismatch. Update your app and reconnect."
      this.setPhase("failed")
      this.setConnectionDetail({
        status: "unavailable",
        reason: "protocol_mismatch",
        message: mismatchMessage,
        since: Date.now()
      })
      return
    }

    this.setPhase("failed")
    this.setConnectionDetail({
      status: "unavailable",
      reason: "server_error",
      message: defaultMessage,
      since: Date.now()
    })
  }

  private setupWSListeners(): (() => void)[] {
    const unsubscribes: (() => void)[] = []

    unsubscribes.push(
      wsManager.on("ready", (payload: ReadyPayload) => {
        preloadWasm()
        warmupWebRTC()

        const usersToAdd: User[] = []
        payload.members.forEach((member) => {
          const updates: Partial<User> = {
            username: member.username,
            avatarUrl: member.avatar_url,
            status: member.status,
            inVoice: member.in_voice ?? false,
            voiceMuted: member.muted ?? false,
            voiceDeafened: member.deafened ?? false,
            voiceSpeaking: false,
            isStreaming: member.streaming ?? false,
            createdAt: member.created_at
          }

          if (this.resolvers?.getUserById(member.id)) {
            this.resolvers.onUserUpdate(member.id, updates)
            return
          }

          usersToAdd.push({
            id: member.id,
            username: member.username,
            avatarUrl: member.avatar_url,
            status: member.status,
            inVoice: member.in_voice ?? false,
            voiceMuted: member.muted ?? false,
            voiceDeafened: member.deafened ?? false,
            voiceSpeaking: false,
            isStreaming: member.streaming ?? false,
            createdAt: member.created_at
          })
        })

        if (usersToAdd.length > 0) {
          this.resolvers?.onUserAdd(usersToAdd)
        }

        this.emit("ready", payload)
      })
    )

    unsubscribes.push(
      wsManager.on("presence_update", (payload) => {
        this.resolvers?.onUserUpdate(payload.user_id, { status: payload.status })
        this.emit("presence_update", payload)
      })
    )

    unsubscribes.push(
      wsManager.on("user_joined", (payload) => {
        const { member } = payload
        this.resolvers?.onUserAdd([
          {
            id: member.id,
            username: member.username,
            avatarUrl: member.avatar_url,
            status: member.status,
            inVoice: member.in_voice ?? false,
            voiceMuted: member.muted ?? false,
            voiceDeafened: member.deafened ?? false,
            voiceSpeaking: false,
            isStreaming: member.streaming ?? false,
            createdAt: member.created_at
          }
        ])
        this.emit("user_joined", payload)
      })
    )

    unsubscribes.push(
      wsManager.on("user_left", (payload) => {
        this.resolvers?.onUserRemove(payload.user_id)
        this.emit("user_left", payload)
      })
    )

    unsubscribes.push(
      wsManager.on("user_update", (payload) => {
        this.resolvers?.onUserUpdate(payload.id, {
          username: payload.username || "",
          avatarUrl: payload.avatar_url
        })
        this.emit("user_update", payload)
      })
    )

    unsubscribes.push(
      wsManager.on("invalid_session", () => {
        stopTokenAutoRefresh()
        this.sessionReplaced = true
      })
    )

    unsubscribes.push(
      wsManager.on("disconnected", () => {
        this.emitLifecycle("voice_stop")
        webrtcManager.stop()

        if (this.sessionReplaced) {
          this.sessionReplaced = false
          this.setPhase("failed")
          this.setConnectionDetail({
            status: "unavailable",
            reason: "session_replaced",
            message: "Signed in from another device.",
            since: Date.now()
          })
          this.emit("disconnected", undefined)
          return
        }

        const disconnectReason = this.classifyDisconnectReason()
        if (disconnectReason === "protocol_mismatch") {
          const mismatchMessage =
            wsManager.getLastServerError()?.message ||
            "Client/server protocol mismatch. Update your app and reconnect."
          this.setPhase("failed")
          this.setConnectionDetail({
            status: "unavailable",
            reason: "protocol_mismatch",
            message: mismatchMessage,
            since: Date.now()
          })
          this.emit("disconnected", undefined)
          return
        }

        if (disconnectReason === "browser_offline") {
          this.setPhase("failed")
          this.setConnectionDetail({
            status: "offline",
            reason: "browser_offline",
            message: "You're offline. Check your internet connection.",
            since: Date.now()
          })
          this.emit("disconnected", undefined)
          return
        }

        this.setPhase("connecting")

        const currentSession = this.session()
        if (currentSession) {
          this.setSession({ ...currentSession, status: "connecting" })
        }

        const serverId = this.currentServer()?.id
        if (serverId) {
          this.setConnectionDetail({
            status: "reconnecting",
            reason: "ws_closed",
            message: `Connection lost. Reconnecting... (attempt ${this.retry.getAttempt() + 1}/${this.retry.getMaxAttempts()})`,
            since: Date.now(),
            reconnectAttempt: this.retry.getAttempt(),
            maxReconnectAttempts: this.retry.getMaxAttempts()
          })
          this.scheduleRetry(serverId)
        }

        this.emit("disconnected", undefined)
      })
    )

    unsubscribes.push(
      wsManager.on("connected", () => {
        startTokenAutoRefresh()

        const currentSession = this.session()
        this.setPhase("connected")
        this.retry.reset()

        if (currentSession) {
          this.setSession({ ...currentSession, status: "connected", connectedAt: Date.now() })
        }

        this.setConnectionDetail({
          status: "healthy",
          reason: "none",
          message: "",
          since: Date.now()
        })

        this.setConnectionVersion((v) => v + 1)

        this.emit("connected", undefined)
      })
    )

    // WS events forwarded directly — stores subscribe via connectionService.on()
    unsubscribes.push(wsManager.on("typing_start", (payload) => this.emit("typing_start", payload)))
    unsubscribes.push(wsManager.on("typing_stop", (payload) => this.emit("typing_stop", payload)))
    unsubscribes.push(
      wsManager.on("voice_state_update", (payload) => this.emit("voice_state_update", payload))
    )
    unsubscribes.push(
      wsManager.on("rtc_ready", (payload: RtcReadyPayload) => this.emit("rtc_ready", payload))
    )
    unsubscribes.push(
      wsManager.on("voice_speaking", (payload: VoiceSpeakingPayload) =>
        this.emit("voice_speaking", payload)
      )
    )
    unsubscribes.push(
      wsManager.on("screen_share_update", (payload) => this.emit("screen_share_update", payload))
    )
    unsubscribes.push(
      wsManager.on("message_create", (payload) => this.emit("message_create", payload))
    )
    unsubscribes.push(
      wsManager.on("server_error", (payload: ErrorPayload) => this.emit("server_error", payload))
    )

    return unsubscribes
  }

  private async connectWS(serverId: string, url: string, token: string): Promise<boolean> {
    const generation = this.connectGeneration

    const unsubscribes = this.setupWSListeners()
    try {
      await wsManager.connect(url, token)
      if (this.connectGeneration !== generation) {
        for (const unsub of unsubscribes) unsub()
        return false
      }
      this.wsUnsubscribes = unsubscribes
    } catch (err) {
      for (const unsub of unsubscribes) unsub()
      throw err
    }

    this.setSession({ serverId, status: "connected", connectedAt: Date.now() })
    return true
  }

  private disconnectWS(): void {
    stopTokenAutoRefresh()
    this.emitLifecycle("voice_stop")
    webrtcManager.stop()
    for (const unsub of this.wsUnsubscribes) unsub()
    this.wsUnsubscribes = []
    wsManager.disconnect()
    this.emitLifecycle("typing_clear")
    this.setSession(null)
  }

  private scheduleRetry(serverId: string): void {
    const scheduled = this.retry.schedule(async () => {
      const success = await this.connectToServer(serverId)
      if (!success) {
        if (this.phase() === "needs_auth") {
          return true
        }
        if (this.connectionDetail().reason === "protocol_mismatch") {
          return true
        }
      }
      return success
    })

    if (!scheduled) {
      this.setPhase("failed")
      this.setConnectionDetail({
        status: "unavailable",
        reason: "server_error",
        message: `Unable to connect after ${this.retry.getMaxAttempts()} attempts.`,
        since: Date.now(),
        reconnectAttempt: this.retry.getAttempt(),
        maxReconnectAttempts: this.retry.getMaxAttempts()
      })
    }
  }

  private getServerIdFromUrl(url: string): string {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  }

  // Public API

  async connectToServer(serverId: string): Promise<boolean> {
    if (this.currentServer()?.id === serverId && this.phase() === "connected") {
      return true
    }

    this.retry.cancel()
    const generation = ++this.connectGeneration

    const storedServers = await window.api.servers.getAll()
    if (this.connectGeneration !== generation) return false
    const server = storedServers.find((s) => s.id === serverId)
    if (!server) return false

    this.disconnectWS()
    this.emitLifecycle("users_clear")
    setTokenManagerServerUrl(server.url)
    this.setCurrentServer({ url: server.url, id: server.id, name: server.name })
    this.setPhase("connecting")

    const hasSession = await hasStoredSession(server.url)
    if (this.connectGeneration !== generation) return false
    if (!hasSession) {
      this.setPhase("needs_auth")
      return false
    }

    const token = await getValidToken()
    if (this.connectGeneration !== generation) return false
    if (!token) {
      const stillHasSession = await hasStoredSession(server.url)
      if (this.connectGeneration !== generation) return false
      if (stillHasSession) {
        this.setPhase("failed")
        this.setConnectionDetail({
          status: "unavailable",
          reason: "server_error",
          message: "Server unavailable. Retrying...",
          since: Date.now()
        })
      } else {
        this.setPhase("needs_auth")
      }
      return false
    }

    try {
      const user = await apiGetMe(server.url, token)
      if (this.connectGeneration !== generation) return false
      this.setCurrentUserId(user.id)
      this.resolvers?.onUserAdd([user])
    } catch (error) {
      if (this.connectGeneration !== generation) return false
      if (error instanceof ApiError && error.status === 401) {
        this.setAuthExpiredState("Session expired. Sign in to continue.")
      } else {
        this.setPhase("failed")
        this.setConnectionDetail({
          status: "unavailable",
          reason: "server_error",
          message: "Server unavailable. Retrying...",
          since: Date.now()
        })
      }
      return false
    }

    try {
      const connected = await this.connectWS(serverId, server.url, token)
      if (this.connectGeneration !== generation) return false
      if (!connected) return false
      this.setPhase("connected")
      await window.api.settings.set("lastActiveServerId", serverId)
      return true
    } catch {
      if (this.connectGeneration !== generation) return false
      this.applyConnectionFailureClassification("Server unavailable. Retrying...")
      return false
    }
  }

  async onAuthSuccess(
    user: User,
    serverUrl: string,
    serverInfo: ServerInfo | null,
    tokens: { accessToken: string; refreshToken: string; expiresAt: string }
  ): Promise<void> {
    const generation = ++this.connectGeneration
    const serverId = this.getServerIdFromUrl(serverUrl)

    await setTokens(serverId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt)
    if (this.connectGeneration !== generation) return
    setTokenManagerServerUrl(serverUrl)

    batch(() => {
      this.setCurrentServer({
        url: serverUrl,
        id: serverId,
        name: serverInfo?.name || "Server",
        info: serverInfo || undefined
      })
      this.setCurrentUserId(user.id)
      this.resolvers?.onUserAdd([user])
    })

    await this.resolvers?.addServerEntry({
      id: serverId,
      name: serverInfo?.name || "Server",
      url: serverUrl,
      email: user.email ?? ""
    })
    if (this.connectGeneration !== generation) return

    try {
      const connected = await this.connectWS(serverId, serverUrl, tokens.accessToken)
      if (this.connectGeneration !== generation) return
      if (!connected) return
      this.setPhase("connected")
      await window.api.settings.set("lastActiveServerId", serverId)
    } catch {
      if (this.connectGeneration !== generation) return
      this.applyConnectionFailureClassification("Server unavailable. Retrying...")
    }
  }

  async retryNow(): Promise<void> {
    this.retry.cancel()
    const serverId = this.currentServer()?.id
    if (serverId) {
      this.retry.reset()
      this.setConnectionDetail({
        status: "reconnecting",
        reason: "ws_closed",
        message: "Connecting to server...",
        since: Date.now(),
        reconnectAttempt: 0,
        maxReconnectAttempts: this.retry.getMaxAttempts()
      })
      const success = await this.connectToServer(serverId)
      if (
        !success &&
        this.phase() === "failed" &&
        this.connectionDetail().reason !== "protocol_mismatch"
      ) {
        this.scheduleRetry(serverId)
      }
    }
  }

  triggerAddServer(): void {
    ++this.connectGeneration
    this.retry.cancel()
    this.disconnectWS()
    batch(() => {
      this.setCurrentServer(null)
      this.setCurrentUserId(null)
      this.setPhase("needs_auth")
    })
  }

  async logout(): Promise<void> {
    ++this.connectGeneration
    this.retry.cancel()
    this.disconnectWS()
    await clearTokenSession()
    this.emitLifecycle("users_clear")
    batch(() => {
      this.setCurrentUserId(null)
      this.setPhase("needs_auth")
    })
  }

  async disconnect(): Promise<void> {
    ++this.connectGeneration
    this.retry.cancel()
    this.disconnectWS()
    await clearTokenSession()
    await clearAllAuthData()
    this.emitLifecycle("users_clear")
    batch(() => {
      this.setCurrentUserId(null)
      this.setCurrentServer(null)
      this.setPhase("disconnected")
    })
  }

  getServerUrl(): string | null {
    return this.currentServer()?.url || null
  }

  setPresence(presenceStatus: "online" | "idle" | "dnd" | "offline"): void {
    if (this.session()?.status === "connected") {
      wsManager.setPresence(presenceStatus)
    }
  }

  updateCurrentUser(updates: Partial<User>): void {
    const userId = this.currentUserId()
    if (userId) {
      const profileUpdates: Partial<User> = {}
      if (updates.username !== undefined) profileUpdates.username = updates.username
      if (updates.avatarUrl !== undefined) profileUpdates.avatarUrl = updates.avatarUrl
      if (updates.email !== undefined) profileUpdates.email = updates.email
      this.resolvers?.onUserUpdate(userId, profileUpdates)
    }
  }

  // WS event subscription (for stores)
  on<T extends WSClientEventType>(
    event: T,
    callback: (data: WSClientEvents[T]) => void
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)?.add(callback as EventCallback<unknown>)
    return () => {
      this.listeners.get(event)?.delete(callback as EventCallback<unknown>)
    }
  }

  private emit<T extends WSClientEventType>(event: T, data: WSClientEvents[T]): void {
    const listeners = this.listeners.get(event)
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(data)
        } catch (err) {
          log.error(`Error in ${event} listener:`, err)
        }
      })
    }
  }

  // Lifecycle event subscription (for stores)
  onLifecycle(event: LifecycleEventType, callback: () => void): () => void {
    if (!this.lifecycleListeners.has(event)) {
      this.lifecycleListeners.set(event, new Set())
    }
    this.lifecycleListeners.get(event)?.add(callback)
    return () => {
      this.lifecycleListeners.get(event)?.delete(callback)
    }
  }

  private emitLifecycle(event: LifecycleEventType): void {
    const listeners = this.lifecycleListeners.get(event)
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback()
        } catch (err) {
          log.error(`Error in lifecycle ${event} listener:`, err)
        }
      })
    }
  }
}

export const connectionService = new ConnectionService()
export { ConnectionService }
