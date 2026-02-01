export type ConnectionStatusType =
  | "offline"
  | "connecting"
  | "reconnecting"
  | "unavailable"
  | "max_retries"

export type ConnectionStatusInfo = {
  type: ConnectionStatusType
  message: string
  showCountdown: boolean
  showRetry: boolean
}

export const CONNECTION_STATUS = {
  offline: {
    type: "offline",
    message: "You're offline. Check your internet connection.",
    showCountdown: false,
    showRetry: true
  },
  connecting: {
    type: "connecting",
    message: "Connecting to server...",
    showCountdown: false,
    showRetry: false
  },
  reconnecting: {
    type: "reconnecting",
    message: "Server unavailable.",
    showCountdown: true,
    showRetry: true
  },
  unavailable: {
    type: "unavailable",
    message: "Server unavailable.",
    showCountdown: true,
    showRetry: true
  },
  maxRetries: (attempts: number): ConnectionStatusInfo => ({
    type: "max_retries",
    message: `Unable to connect after ${attempts} attempts.`,
    showCountdown: false,
    showRetry: true
  })
} as const satisfies Record<
  string,
  ConnectionStatusInfo | ((...args: never[]) => ConnectionStatusInfo)
>

export const CONNECTION_MESSAGES = {
  reconnecting: "Reconnecting...",
  retrying: (seconds: number) => `Retrying in ${seconds}s...`
} as const
