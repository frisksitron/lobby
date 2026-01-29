import { electronAPI } from "@electron-toolkit/preload"
import { contextBridge, ipcRenderer } from "electron"
import type { AppSettings, SecureTokens, ServerEntry, ThemeMode } from "../shared/types"

// Custom APIs for renderer
const api = {
  // Secure token storage (safeStorage) - per-server
  storage: {
    setTokens: (serverId: string, tokens: SecureTokens): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("storage:secure:set-tokens", { serverId, tokens }),
    getTokens: (serverId: string): Promise<SecureTokens | null> =>
      ipcRenderer.invoke("storage:secure:get-tokens", serverId),
    clearTokens: (serverId?: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("storage:secure:clear-tokens", serverId),
    isSecureAvailable: (): Promise<{ available: boolean }> =>
      ipcRenderer.invoke("storage:secure:is-available")
  },

  // App settings (electron-store)
  settings: {
    getAll: (): Promise<AppSettings> => ipcRenderer.invoke("storage:settings:get-all"),
    set: <K extends keyof AppSettings>(
      key: K,
      value: AppSettings[K]
    ): Promise<{ success: boolean }> => ipcRenderer.invoke("storage:settings:set", { key, value }),
    clear: (): Promise<{ success: boolean }> => ipcRenderer.invoke("storage:settings:clear")
  },

  // Server list (electron-store)
  servers: {
    getAll: (): Promise<ServerEntry[]> => ipcRenderer.invoke("storage:servers:get-all"),
    add: (server: ServerEntry): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("storage:servers:add", server),
    remove: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("storage:servers:remove", { id })
  },

  // Theme (native window decorations)
  theme: {
    setNativeMode: (mode: ThemeMode): Promise<void> => ipcRenderer.invoke("theme:set-native", mode)
  },

  // Auto-updater
  updater: {
    check: (): Promise<{ success: boolean; version?: string; error?: string }> =>
      ipcRenderer.invoke("updater:check"),
    install: (): Promise<void> => ipcRenderer.invoke("updater:install"),
    onChecking: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on("updater:checking", handler)
      return () => ipcRenderer.removeListener("updater:checking", handler)
    },
    onAvailable: (callback: (info: { version: string; releaseNotes?: string }) => void) => {
      const handler = (_: unknown, info: { version: string; releaseNotes?: string }) =>
        callback(info)
      ipcRenderer.on("updater:available", handler)
      return () => ipcRenderer.removeListener("updater:available", handler)
    },
    onNotAvailable: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on("updater:not-available", handler)
      return () => ipcRenderer.removeListener("updater:not-available", handler)
    },
    onProgress: (
      callback: (progress: {
        percent: number
        bytesPerSecond: number
        transferred: number
        total: number
      }) => void
    ) => {
      const handler = (
        _: unknown,
        progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }
      ) => callback(progress)
      ipcRenderer.on("updater:progress", handler)
      return () => ipcRenderer.removeListener("updater:progress", handler)
    },
    onDownloaded: (callback: (info: { version: string; releaseNotes?: string }) => void) => {
      const handler = (_: unknown, info: { version: string; releaseNotes?: string }) =>
        callback(info)
      ipcRenderer.on("updater:downloaded", handler)
      return () => ipcRenderer.removeListener("updater:downloaded", handler)
    },
    onError: (callback: (error: string) => void) => {
      const handler = (_: unknown, error: string) => callback(error)
      ipcRenderer.on("updater:error", handler)
      return () => ipcRenderer.removeListener("updater:error", handler)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI)
    contextBridge.exposeInMainWorld("api", api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error (define in dts)
  window.electron = electronAPI
  // @ts-expect-error (define in dts)
  window.api = api
}
