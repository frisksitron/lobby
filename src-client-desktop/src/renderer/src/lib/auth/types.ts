import type { User } from "../../../../shared/types"
import type { ServerInfo } from "../api/types"

// Connection state machine states
export type ConnectionState =
  | "disconnected" // No session, show server select
  | "checking_session" // Checking stored session on app start
  | "needs_auth" // Has stored session but needs re-auth (expired, or no stored session but has servers)
  | "connecting" // Connecting to server after auth
  | "connected" // Fully connected
  | "server_unavailable" // Server cannot be reached (network error, server down)

// Auth flow UI steps
export type AuthFlowStep = "server-url" | "email-input" | "code-input" | "register"

// Server connection info
export interface ServerConnection {
  url: string
  id: string
  name: string
  info?: ServerInfo
}

// Re-export User type for convenience
export type { User }
