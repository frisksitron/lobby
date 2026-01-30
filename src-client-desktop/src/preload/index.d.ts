import { ElectronAPI } from "@electron-toolkit/preload"
import type { SecureTokens, AppSettings, ServerEntry, ThemeMode } from "../shared/types"

interface LobbyAPI {
  // Secure token storage (safeStorage) - per-server
  storage: {
    setTokens: (serverId: string, tokens: SecureTokens) => Promise<{ success: boolean }>
    getTokens: (serverId: string) => Promise<SecureTokens | null>
    clearTokens: (serverId?: string) => Promise<{ success: boolean }>
    isSecureAvailable: () => Promise<{ available: boolean }>
  }

  // App settings (electron-store)
  settings: {
    getAll: () => Promise<AppSettings>
    set: <K extends keyof AppSettings>(
      key: K,
      value: AppSettings[K]
    ) => Promise<{ success: boolean }>
    clear: () => Promise<{ success: boolean }>
  }

  // Server list (electron-store)
  servers: {
    getAll: () => Promise<ServerEntry[]>
    add: (server: ServerEntry) => Promise<{ success: boolean }>
    remove: (id: string) => Promise<{ success: boolean }>
  }

  // Theme (native window decorations)
  theme: {
    setNativeMode: (mode: ThemeMode) => Promise<void>
  }

  // Screen capture for screen sharing
  screen: {
    getSources: () => Promise<{ id: string; name: string; thumbnail: string }[]>
  }

  // Auto-updater
  updater: {
    check: () => Promise<{ success: boolean; version?: string; error?: string }>
    install: () => Promise<void>
    onChecking: (callback: () => void) => () => void
    onAvailable: (
      callback: (info: { version: string; releaseNotes?: string }) => void
    ) => () => void
    onNotAvailable: (callback: () => void) => () => void
    onProgress: (
      callback: (progress: {
        percent: number
        bytesPerSecond: number
        transferred: number
        total: number
      }) => void
    ) => () => void
    onDownloaded: (
      callback: (info: { version: string; releaseNotes?: string }) => void
    ) => () => void
    onError: (callback: (error: string) => void) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: LobbyAPI
  }
}
