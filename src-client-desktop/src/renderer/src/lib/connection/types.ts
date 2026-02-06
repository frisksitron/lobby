import type { ServerInfo } from "../api/types"

export type ConnectionPhase =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "needs_auth"

export type ConnectionDetailStatus = "healthy" | "offline" | "reconnecting" | "unavailable"

export type ConnectionDetailReason =
  | "none"
  | "browser_offline"
  | "ws_closed"
  | "server_error"
  | "auth_expired"

export interface ConnectionDetail {
  status: ConnectionDetailStatus
  reason: ConnectionDetailReason
  message: string
  since: number
  reconnectAttempt?: number
  maxReconnectAttempts?: number
  countdownSeconds?: number
}

export interface ServerConnection {
  url: string
  id: string
  name: string
  info?: ServerInfo
}

export interface ConnectionState {
  phase: ConnectionPhase
  server: ServerConnection | null
  userId: string | null
  wsConnected: boolean
  isOnline: boolean
  detail: ConnectionDetail
}

export const DEFAULT_CONNECTION_DETAIL: ConnectionDetail = {
  status: "healthy",
  reason: "none",
  message: "",
  since: Date.now()
}

export const DEFAULT_CONNECTION_STATE: ConnectionState = {
  phase: "disconnected",
  server: null,
  userId: null,
  wsConnected: false,
  isOnline: true,
  detail: DEFAULT_CONNECTION_DETAIL
}

// Event types emitted by ConnectionService
export type ConnectionEventType =
  | "phase_change"
  | "detail_change"
  | "ready"
  | "message"
  | "presence_update"
  | "typing_start"
  | "typing_stop"
  | "voice_state"
  | "rtc_ready"
  | "voice_speaking"
  | "user_joined"
  | "user_left"
  | "user_update"
  | "screen_share_update"
  | "server_error"
  | "network_status"

export interface ConnectionEvents {
  phase_change: { phase: ConnectionPhase; previous: ConnectionPhase }
  detail_change: ConnectionDetail
  ready: import("../ws/types").ReadyPayload
  message: import("../ws/types").MessageCreatePayload
  presence_update: import("../ws/types").PresenceUpdatePayload
  typing_start: import("../ws/types").TypingStartPayload
  typing_stop: import("../ws/types").TypingStopPayload
  voice_state: import("../ws/types").VoiceStateUpdatePayload
  rtc_ready: import("../ws/types").RtcReadyPayload
  voice_speaking: import("../ws/types").VoiceSpeakingPayload
  user_joined: import("../ws/types").UserJoinedPayload
  user_left: import("../ws/types").UserLeftPayload
  user_update: import("../ws/types").UserUpdatePayload
  screen_share_update: import("../ws/types").ScreenShareUpdatePayload
  server_error: import("../ws/types").ErrorPayload
  network_status: { online: boolean }
}
