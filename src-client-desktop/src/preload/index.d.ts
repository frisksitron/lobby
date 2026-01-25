import { ElectronAPI } from "@electron-toolkit/preload"
import type { SecureTokens, AppSettings, ServerEntry } from "../shared/types"

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
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: LobbyAPI
  }
}
