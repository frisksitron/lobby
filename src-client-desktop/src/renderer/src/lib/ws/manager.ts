import { getValidToken, onTokenRefresh } from "../auth/token-manager"
import { createLogger } from "../logger"
import {
  type ErrorPayload,
  type HelloPayload,
  type InvalidSessionPayload,
  type MessageCreatePayload,
  type PresenceUpdatePayload,
  type ReadyPayload,
  type RtcAnswerPayload,
  type RtcIceCandidatePayload,
  type RtcOfferPayload,
  type RtcReadyPayload,
  type TypingStartPayload,
  type TypingStopPayload,
  type UserJoinedPayload,
  type UserLeftPayload,
  type UserUpdatePayload,
  type VoiceSpeakingPayload,
  type VoiceStateUpdatePayload,
  type WSClientEvents,
  type WSClientEventType,
  WSCommandType,
  type WSConnectionState,
  WSEventType,
  type WSMessage,
  WSOpCode
} from "./types"

const log = createLogger("WS")

type EventCallback<T extends WSClientEventType> = (data: WSClientEvents[T]) => void

const RECONNECT_DELAYS = [1, 2, 5, 10, 30, 60]

class WebSocketManager {
  private ws: WebSocket | null = null
  private serverUrl: string = ""
  private token: string = ""
  private state: WSConnectionState = "disconnected"
  private reconnectAttempt: number = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private listeners: Map<WSClientEventType, Set<EventCallback<WSClientEventType>>> = new Map()
  private shouldReconnect: boolean = true
  private lastSequence: number = 0
  private sessionId: string = ""
  private disconnectReason: "auth" | "network" | "normal" = "normal"
  private serverUnavailableEmitted: boolean = false

  constructor() {
    const eventTypes: WSClientEventType[] = [
      "connected",
      "disconnected",
      "ready",
      "message_create",
      "presence_update",
      "typing_start",
      "typing_stop",
      "user_update",
      "voice_state_update",
      "rtc_ready",
      "rtc_offer",
      "rtc_answer",
      "rtc_ice_candidate",
      "voice_speaking",
      "user_joined",
      "user_left",
      "invalid_session",
      "server_unavailable",
      "error",
      "server_error"
    ]
    for (const type of eventTypes) {
      this.listeners.set(type, new Set())
    }

    onTokenRefresh((newToken) => {
      this.updateToken(newToken)
    })
  }

  /**
   * Update the token used for WebSocket authentication
   * Called when token is refreshed by token-manager
   */
  updateToken(newToken: string): void {
    this.token = newToken
    log.info("Token updated")
  }

  /**
   * Connect to the WebSocket server
   */
  connect(serverUrl: string, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const isFreshConnection = this.serverUrl !== serverUrl
      this.cleanup()

      this.serverUrl = serverUrl
      this.token = token
      this.state = "connecting"
      this.shouldReconnect = true

      if (isFreshConnection) {
        this.reconnectAttempt = 0
        this.disconnectReason = "normal"
        this.serverUnavailableEmitted = false
      }

      const wsUrl = `${serverUrl.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`

      try {
        this.ws = new WebSocket(wsUrl)
      } catch (error) {
        this.state = "disconnected"
        reject(error)
        return
      }

      let settled = false

      const onOpen = (): void => {
        log.info("Connected")
      }

      const onMessage = (event: MessageEvent): void => {
        try {
          const message: WSMessage = JSON.parse(event.data)
          this.handleMessage(message)

          if (message.op === WSOpCode.Ready) {
            settled = true
            resolve()
          }
        } catch (error) {
          log.error("Failed to parse message:", error)
        }
      }

      const onError = (event: Event): void => {
        log.error("WebSocket error:", event)
        this.emit("error", new Error("WebSocket connection error"))
        if (!settled) {
          settled = true
          reject(new Error("WebSocket connection error"))
        }
      }

      const onClose = (event: CloseEvent): void => {
        log.info("Connection closed:", event.code, event.reason)

        const wasConnected = this.state === "connected"
        this.state = "disconnected"

        if (event.code === 4001) {
          this.disconnectReason = "auth"
        } else if (event.code !== 1000) {
          this.disconnectReason = "network"
        }

        if (wasConnected) {
          this.emit("disconnected", undefined)
        }

        if (!settled) {
          settled = true
          reject(new Error(`WebSocket closed before ready: ${event.code}`))
        }

        if (this.shouldReconnect && event.code !== 1000) {
          this.scheduleReconnect()
        }
      }

      this.ws.addEventListener("open", onOpen)
      this.ws.addEventListener("message", onMessage)
      this.ws.addEventListener("error", onError)
      this.ws.addEventListener("close", onClose)
    })
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.shouldReconnect = false
    this.cleanup()
    this.state = "disconnected"
    this.emit("disconnected", undefined)
  }

  /**
   * Send a chat message
   */
  sendMessage(content: string, nonce?: string): void {
    this.sendDispatch(WSCommandType.MessageSend, { content, nonce })
  }

  /**
   * Set presence status
   */
  setPresence(status: "online" | "idle" | "dnd" | "offline"): void {
    this.sendDispatch(WSCommandType.PresenceSet, { status })
  }

  /**
   * Send typing indicator
   */
  sendTyping(): void {
    this.sendDispatch(WSCommandType.Typing, {})
  }

  /**
   * Join voice channel
   */
  joinVoice(muted?: boolean, deafened?: boolean): void {
    this.sendDispatch(WSCommandType.VoiceJoin, { muted, deafened })
  }

  /**
   * Leave voice channel
   */
  leaveVoice(): void {
    this.sendDispatch(WSCommandType.VoiceLeave, {})
  }

  /**
   * Send RTC offer
   */
  sendRtcOffer(sdp: string): void {
    this.sendDispatch(WSCommandType.RtcOffer, { sdp })
  }

  /**
   * Send RTC answer
   */
  sendRtcAnswer(sdp: string): void {
    this.sendDispatch(WSCommandType.RtcAnswer, { sdp })
  }

  /**
   * Send RTC ICE candidate
   */
  sendRtcIceCandidate(candidate: RTCIceCandidate): void {
    this.sendDispatch(WSCommandType.RtcIceCandidate, {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex
    })
  }

  /**
   * Send voice state update (mute/deafen/speaking)
   */
  sendVoiceState(state: { muted?: boolean; deafened?: boolean; speaking?: boolean }): void {
    this.sendDispatch(WSCommandType.VoiceStateSet, state)
  }

  /**
   * Subscribe to an event
   */
  on<T extends WSClientEventType>(event: T, callback: EventCallback<T>): () => void {
    const listeners = this.listeners.get(event)
    if (listeners) {
      listeners.add(callback as EventCallback<WSClientEventType>)
    }

    return () => {
      listeners?.delete(callback as EventCallback<WSClientEventType>)
    }
  }

  /**
   * Get current connection state
   */
  getState(): WSConnectionState {
    return this.state
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === "connected"
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string {
    return this.sessionId
  }

  /**
   * Get the last received sequence number
   */
  getLastSequence(): number {
    return this.lastSequence
  }

  private handleMessage(message: WSMessage): void {
    switch (message.op) {
      case WSOpCode.Hello:
        this.handleHello(message.d as HelloPayload)
        break

      case WSOpCode.Ready:
        this.handleReady(message.d as ReadyPayload)
        break

      case WSOpCode.Resumed:
        this.handleResumed()
        break

      case WSOpCode.InvalidSession:
        this.handleInvalidSession(message.d as InvalidSessionPayload)
        break

      case WSOpCode.Reconnect:
        this.handleReconnect()
        break

      case WSOpCode.Dispatch:
        this.handleDispatch(message)
        break

      default:
        log.info("Unknown opcode:", message.op)
    }
  }

  private handleHello(payload: HelloPayload): void {
    log.info("Received HELLO, heartbeat interval:", payload.heartbeat_interval)
    this.sendDispatch(WSCommandType.Identify, { token: this.token })
  }

  private handleReady(payload: ReadyPayload): void {
    log.info("Received READY, session:", payload.session_id)
    this.state = "connected"
    this.reconnectAttempt = 0
    this.sessionId = payload.session_id
    this.disconnectReason = "normal"
    this.serverUnavailableEmitted = false
    this.emit("connected", undefined)
    this.emit("ready", payload)
  }

  private handleResumed(): void {
    log.info("Received RESUMED")
    this.state = "connected"
    this.reconnectAttempt = 0
    this.disconnectReason = "normal"
    this.serverUnavailableEmitted = false
    this.emit("connected", undefined)
  }

  private handleInvalidSession(payload: InvalidSessionPayload): void {
    log.info("Received INVALID_SESSION, resumable:", payload.resumable)
    this.emit("invalid_session", payload)

    if (!payload.resumable) {
      this.sessionId = ""
      this.lastSequence = 0
      this.sendDispatch(WSCommandType.Identify, { token: this.token })
    }
  }

  private handleReconnect(): void {
    log.info("Received RECONNECT from server")
    this.ws?.close(1000, "Server requested reconnect")
  }

  private handleDispatch(message: WSMessage): void {
    if (message.s !== undefined) {
      this.lastSequence = message.s
    }

    switch (message.t) {
      case WSEventType.MessageCreate:
        this.emit("message_create", message.d as MessageCreatePayload)
        break

      case WSEventType.PresenceUpdate:
        this.emit("presence_update", message.d as PresenceUpdatePayload)
        break

      case WSEventType.TypingStart:
        this.emit("typing_start", message.d as TypingStartPayload)
        break

      case WSEventType.TypingStop:
        this.emit("typing_stop", message.d as TypingStopPayload)
        break

      case WSEventType.UserUpdate:
        this.emit("user_update", message.d as UserUpdatePayload)
        break

      case WSEventType.VoiceStateUpdate:
        this.emit("voice_state_update", message.d as VoiceStateUpdatePayload)
        break

      case WSEventType.RtcReady:
        this.emit("rtc_ready", message.d as RtcReadyPayload)
        break

      case WSEventType.RtcOffer:
        this.emit("rtc_offer", message.d as RtcOfferPayload)
        break

      case WSEventType.RtcAnswer:
        this.emit("rtc_answer", message.d as RtcAnswerPayload)
        break

      case WSEventType.RtcIceCandidate:
        this.emit("rtc_ice_candidate", message.d as RtcIceCandidatePayload)
        break

      case WSEventType.VoiceSpeaking:
        this.emit("voice_speaking", message.d as VoiceSpeakingPayload)
        break

      case WSEventType.UserJoined:
        this.emit("user_joined", message.d as UserJoinedPayload)
        break

      case WSEventType.UserLeft:
        this.emit("user_left", message.d as UserLeftPayload)
        break

      case WSEventType.Error:
        this.emit("server_error", message.d as ErrorPayload)
        break

      default:
        log.info("Unknown dispatch type:", message.t)
    }
  }

  private send(message: WSMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  private sendDispatch(type: WSCommandType, data: unknown): void {
    this.send({
      op: WSOpCode.Dispatch,
      t: type,
      d: data
    })
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)]
    log.info(`Reconnecting in ${delay}s (attempt ${this.reconnectAttempt + 1})`)

    this.state = "reconnecting"

    if (this.disconnectReason === "network" && !this.serverUnavailableEmitted) {
      this.serverUnavailableEmitted = true
      log.info("Server unavailable - network error")
      this.emit("server_unavailable", undefined)
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempt++

      try {
        const freshToken = await getValidToken()
        if (freshToken) {
          this.token = freshToken
          log.info("Got fresh token for reconnection")
        } else {
          log.info("No valid token available, stopping reconnection")
          this.shouldReconnect = false
          this.state = "disconnected"
          this.disconnectReason = "auth"
          this.emit("invalid_session", { resumable: false })
          return
        }
      } catch (error) {
        log.error("Failed to get fresh token:", error)
        if (this.serverUnavailableEmitted) {
          log.info("Token refresh failed during server unavailable, scheduling retry")
          this.scheduleReconnect()
          return
        }
        this.shouldReconnect = false
        this.state = "disconnected"
        this.disconnectReason = "auth"
        this.emit("invalid_session", { resumable: false })
        return
      }

      this.connect(this.serverUrl, this.token).catch((error) => {
        log.error("Reconnection failed:", error)
      })
    }, delay * 1000)
  }

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      this.ws.close(1000, "Client disconnect")
      this.ws = null
    }
  }

  private emit<T extends WSClientEventType>(event: T, data: WSClientEvents[T]): void {
    const listeners = this.listeners.get(event)
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(data)
        } catch (error) {
          log.error(`Error in ${event} listener:`, error)
        }
      })
    }
  }
}

export const wsManager = new WebSocketManager()
export { WebSocketManager }
