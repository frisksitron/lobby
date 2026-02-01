import { type Accessor, batch, createSignal, type Setter } from "solid-js"
import type { User } from "../../../../shared/types"
import { getMe as apiGetMe, getUsers } from "../api/auth"
import type { ServerInfo } from "../api/types"
import { ApiError } from "../api/types"
import {
  clearSession as clearTokenSession,
  getValidToken,
  hasStoredSession,
  setServerUrl as setTokenManagerServerUrl
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

  // External event listeners
  private listeners = new Map<WSClientEventType, Set<EventCallback<unknown>>>()

  // Callbacks for dependent stores
  private onVoiceStateUpdate: ((payload: unknown) => void) | null = null
  private onRtcReady: ((payload: RtcReadyPayload) => void) | null = null
  private onVoiceSpeaking: ((payload: VoiceSpeakingPayload) => void) | null = null
  private onTypingStart: ((payload: unknown) => void) | null = null
  private onTypingStop: ((payload: unknown) => void) | null = null
  private onScreenShareUpdate: ((payload: unknown) => void) | null = null
  private onServerError: ((payload: ErrorPayload) => void) | null = null
  private onUserAdd: ((users: User[]) => void) | null = null
  private onUserUpdate: ((userId: string, updates: Partial<User>) => void) | null = null
  private getUserById: ((userId: string) => User | undefined) | null = null
  private onUsersClear: (() => void) | null = null
  private onTypingClear: (() => void) | null = null
  private saveVoiceState: (() => void) | null = null
  private restoreVoiceState: (() => void) | null = null
  private resetVoiceReconnect: (() => void) | null = null
  private stopVoiceFn: (() => void) | null = null

  // Server management
  private loadServersFn: (() => Promise<void>) | null = null
  private addServerEntryFn:
    | ((entry: { id: string; name: string; url: string; email: string }) => Promise<void>)
    | null = null
  private getServersFn: (() => { id: string; name: string; url: string }[]) | null = null

  constructor() {
    // Initialize signals
    const [phase, setPhase] = createSignal<ConnectionPhase>("initializing")
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

  // Initialize dependent module callbacks
  initCallbacks(callbacks: {
    onVoiceStateUpdate?: (payload: unknown) => void
    onRtcReady?: (payload: RtcReadyPayload) => void
    onVoiceSpeaking?: (payload: VoiceSpeakingPayload) => void
    onTypingStart?: (payload: unknown) => void
    onTypingStop?: (payload: unknown) => void
    onScreenShareUpdate?: (payload: unknown) => void
    onServerError?: (payload: ErrorPayload) => void
    onUserAdd?: (users: User[]) => void
    onUserUpdate?: (userId: string, updates: Partial<User>) => void
    getUserById?: (userId: string) => User | undefined
    onUsersClear?: () => void
    onTypingClear?: () => void
    saveVoiceState?: () => void
    restoreVoiceState?: () => void
    resetVoiceReconnect?: () => void
    stopVoice?: () => void
    loadServers?: () => Promise<void>
    addServerEntry?: (entry: {
      id: string
      name: string
      url: string
      email: string
    }) => Promise<void>
    getServers?: () => { id: string; name: string; url: string }[]
  }): void {
    this.onVoiceStateUpdate = callbacks.onVoiceStateUpdate ?? null
    this.onRtcReady = callbacks.onRtcReady ?? null
    this.onVoiceSpeaking = callbacks.onVoiceSpeaking ?? null
    this.onTypingStart = callbacks.onTypingStart ?? null
    this.onTypingStop = callbacks.onTypingStop ?? null
    this.onScreenShareUpdate = callbacks.onScreenShareUpdate ?? null
    this.onServerError = callbacks.onServerError ?? null
    this.onUserAdd = callbacks.onUserAdd ?? null
    this.onUserUpdate = callbacks.onUserUpdate ?? null
    this.getUserById = callbacks.getUserById ?? null
    this.onUsersClear = callbacks.onUsersClear ?? null
    this.onTypingClear = callbacks.onTypingClear ?? null
    this.saveVoiceState = callbacks.saveVoiceState ?? null
    this.restoreVoiceState = callbacks.restoreVoiceState ?? null
    this.resetVoiceReconnect = callbacks.resetVoiceReconnect ?? null
    this.stopVoiceFn = callbacks.stopVoice ?? null
    this.loadServersFn = callbacks.loadServers ?? null
    this.addServerEntryFn = callbacks.addServerEntry ?? null
    this.getServersFn = callbacks.getServers ?? null
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
      }
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
            status: member.status,
            inVoice: member.in_voice ?? false,
            voiceMuted: member.muted ?? false,
            voiceDeafened: member.deafened ?? false,
            voiceSpeaking: false,
            isStreaming: member.streaming ?? false,
            createdAt: member.created_at
          }

          if (this.getUserById?.(member.id)) {
            this.onUserUpdate?.(member.id, updates)
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
          this.onUserAdd?.(usersToAdd)
        }

        this.emit("ready", payload)
      })
    )

    unsubscribes.push(
      wsManager.on("presence_update", (payload) => {
        this.onUserUpdate?.(payload.user_id, { status: payload.status })
        this.emit("presence_update", payload)
      })
    )

    unsubscribes.push(
      wsManager.on("user_joined", (payload) => {
        const { member } = payload
        this.onUserAdd?.([
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
        this.onUserUpdate?.(payload.user_id, {
          status: "offline",
          inVoice: false,
          voiceMuted: false,
          voiceDeafened: false,
          voiceSpeaking: false,
          isStreaming: false
        })
        this.emit("user_left", payload)
      })
    )

    unsubscribes.push(
      wsManager.on("user_update", (payload) => {
        this.onUserUpdate?.(payload.id, {
          username: payload.username || "",
          avatarUrl: payload.avatar_url
        })
        this.emit("user_update", payload)
      })
    )

    unsubscribes.push(
      wsManager.on("disconnected", () => {
        this.saveVoiceState?.()
        this.stopVoiceFn?.()
        webrtcManager.stop()

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
        this.restoreVoiceState?.()

        this.emit("connected", undefined)
      })
    )

    unsubscribes.push(
      wsManager.on("typing_start", (payload) => {
        this.onTypingStart?.(payload)
        this.emit("typing_start", payload)
      })
    )

    unsubscribes.push(
      wsManager.on("typing_stop", (payload) => {
        this.onTypingStop?.(payload)
        this.emit("typing_stop", payload)
      })
    )

    unsubscribes.push(
      wsManager.on("voice_state_update", (payload) => {
        this.onVoiceStateUpdate?.(payload)
        this.emit("voice_state_update", payload)
      })
    )

    unsubscribes.push(
      wsManager.on("rtc_ready", (payload: RtcReadyPayload) => {
        this.onRtcReady?.(payload)
        this.emit("rtc_ready", payload)
      })
    )

    unsubscribes.push(
      wsManager.on("voice_speaking", (payload: VoiceSpeakingPayload) => {
        this.onVoiceSpeaking?.(payload)
        this.emit("voice_speaking", payload)
      })
    )

    unsubscribes.push(
      wsManager.on("screen_share_update", (payload) => {
        this.onScreenShareUpdate?.(payload)
        this.emit("screen_share_update", payload)
      })
    )

    unsubscribes.push(
      wsManager.on("server_error", (payload: ErrorPayload) => {
        this.onServerError?.(payload)
        this.emit("server_error", payload)
      })
    )

    return unsubscribes
  }

  private async connectWS(serverId: string, url: string, token: string): Promise<void> {
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
      this.onUserAdd?.(usersWithDefaults)
    } catch (err) {
      log.error("Failed to fetch users:", err)
    }

    const unsubscribes = this.setupWSListeners()
    try {
      await wsManager.connect(url, token)
      this.wsUnsubscribes = unsubscribes
    } catch (err) {
      for (const unsub of unsubscribes) unsub()
      throw err
    }

    this.setSession({ serverId, status: "connected", connectedAt: Date.now() })
  }

  private disconnectWS(): void {
    this.resetVoiceReconnect?.()
    this.stopVoiceFn?.()
    webrtcManager.stop()
    for (const unsub of this.wsUnsubscribes) unsub()
    this.wsUnsubscribes = []
    wsManager.disconnect()
    this.onTypingClear?.()
    this.setSession(null)
  }

  private scheduleRetry(serverId: string): void {
    const scheduled = this.retry.schedule(async () => {
      const success = await this.connectToServer(serverId)
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

  async initialize(): Promise<void> {
    this.setPhase("initializing")

    try {
      await this.loadServersFn?.()
      const settings = await window.api.settings.getAll()
      const serverList = this.getServersFn?.() ?? []

      if (serverList.length === 0) {
        this.setPhase("disconnected")
        return
      }

      const lastServer = settings.lastActiveServerId
        ? serverList.find((s) => s.id === settings.lastActiveServerId)
        : serverList[0]

      if (!lastServer) {
        this.setPhase("disconnected")
        return
      }

      const success = await this.connectToServer(lastServer.id)
      if (!success && this.phase() === "failed") {
        this.scheduleRetry(lastServer.id)
      }
    } catch {
      this.setPhase("disconnected")
    }
  }

  async connectToServer(serverId: string): Promise<boolean> {
    if (this.currentServer()?.id === serverId && this.phase() === "connected") {
      return true
    }

    this.retry.cancel()

    const storedServers = await window.api.servers.getAll()
    const server = storedServers.find((s) => s.id === serverId)
    if (!server) return false

    this.disconnectWS()
    this.onUsersClear?.()
    setTokenManagerServerUrl(server.url)
    this.setCurrentServer({ url: server.url, id: server.id, name: server.name })
    this.setPhase("connecting")

    const hasSession = await hasStoredSession(server.url)
    if (!hasSession) {
      this.setPhase("needs_auth")
      return false
    }

    const token = await getValidToken()
    if (!token) {
      const stillHasSession = await hasStoredSession(server.url)
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
      this.setCurrentUserId(user.id)
      this.onUserAdd?.([user])
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.setPhase("needs_auth")
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
      await this.connectWS(serverId, server.url, token)
      this.setPhase("connected")
      await window.api.settings.set("lastActiveServerId", serverId)
      return true
    } catch {
      this.setPhase("failed")
      this.setConnectionDetail({
        status: "unavailable",
        reason: "server_error",
        message: "Server unavailable. Retrying...",
        since: Date.now()
      })
      return false
    }
  }

  async onAuthSuccess(
    user: User,
    serverUrl: string,
    serverInfo: ServerInfo | null,
    tokens: { accessToken: string; refreshToken: string; expiresAt: string }
  ): Promise<void> {
    const serverId = this.getServerIdFromUrl(serverUrl)

    await setTokens(serverId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt)
    setTokenManagerServerUrl(serverUrl)

    batch(() => {
      this.setCurrentServer({
        url: serverUrl,
        id: serverId,
        name: serverInfo?.name || "Server",
        info: serverInfo || undefined
      })
      this.setCurrentUserId(user.id)
      this.onUserAdd?.([user])
    })

    await this.addServerEntryFn?.({
      id: serverId,
      name: serverInfo?.name || "Server",
      url: serverUrl,
      email: user.email ?? ""
    })

    try {
      await this.connectWS(serverId, serverUrl, tokens.accessToken)
      this.setPhase("connected")
      await window.api.settings.set("lastActiveServerId", serverId)
    } catch {
      this.setPhase("needs_auth")
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
      if (!success && this.phase() === "failed") {
        this.scheduleRetry(serverId)
      }
    }
  }

  triggerAddServer(): void {
    this.retry.cancel()
    this.disconnectWS()
    batch(() => {
      this.setCurrentServer(null)
      this.setCurrentUserId(null)
      this.setPhase("disconnected")
    })
  }

  triggerReauth(): void {
    this.disconnectWS()
    this.setPhase("needs_auth")
  }

  async logout(): Promise<void> {
    this.retry.cancel()
    this.disconnectWS()
    await clearTokenSession()
    this.onUsersClear?.()
    batch(() => {
      this.setCurrentUserId(null)
      this.setPhase("needs_auth")
    })
  }

  async disconnect(): Promise<void> {
    this.retry.cancel()
    this.disconnectWS()
    await clearTokenSession()
    await clearAllAuthData()
    this.onUsersClear?.()
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
      this.onUserUpdate?.(userId, profileUpdates)
    }
  }

  // Event subscription
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
}

export const connectionService = new ConnectionService()
export { ConnectionService }
