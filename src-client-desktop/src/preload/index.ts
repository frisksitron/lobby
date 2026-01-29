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
