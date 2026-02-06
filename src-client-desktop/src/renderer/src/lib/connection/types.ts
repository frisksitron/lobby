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
