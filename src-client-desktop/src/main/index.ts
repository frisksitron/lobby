import { join } from "node:path"
import { electronApp, is, optimizer } from "@electron-toolkit/utils"
import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron"
import Store from "electron-store"
import icon from "../../resources/icon.png?asset"
import { createLogger } from "./logger"

const log = createLogger("Main")

interface SecureTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string
}

type NoiseSuppressionAlgorithm = "speex" | "rnnoise" | "none"

interface AppSettings {
  inputDevice: string
  outputDevice: string
  lastActiveServerId: string | null
  noiseSuppression: NoiseSuppressionAlgorithm
  themeId: string
  userVolumes: Record<string, number>
}

interface ServerEntry {
  id: string
  name: string
  url: string
  iconUrl?: string
}

interface StoreSchema {
  encryptedTokens: string | null
  settings: AppSettings
  servers: ServerEntry[]
}

const DEFAULT_SETTINGS: AppSettings = {
  inputDevice: "default",
  outputDevice: "default",
  lastActiveServerId: null,
  noiseSuppression: "rnnoise",
  themeId: "discord",
  userVolumes: {}
}

const INSTANCE_ID = process.env.LOBBY_INSTANCE_ID || ""
const ALLOW_MULTIPLE = process.env.ALLOW_MULTIPLE_INSTANCES === "true"

if (INSTANCE_ID) {
  const defaultUserData = app.getPath("userData")
  app.setPath("userData", `${defaultUserData}-instance-${INSTANCE_ID}`)
}

const store = new Store<StoreSchema>({
  name: INSTANCE_ID ? `config-${INSTANCE_ID}` : "config",
  defaults: {
    encryptedTokens: null,
    settings: DEFAULT_SETTINGS,
    servers: []
  }
})

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    minWidth: 480,
    minHeight: 400,
    show: false,
    autoHideMenuBar: true,
    title: INSTANCE_ID ? `Lobby (Instance ${INSTANCE_ID})` : "Lobby",
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false
    }
  })

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }

  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

const gotTheLock = ALLOW_MULTIPLE || app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId(INSTANCE_ID ? `com.lobby.instance-${INSTANCE_ID}` : "com.lobby")

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle("storage:secure:is-available", () => {
    return { available: safeStorage.isEncryptionAvailable() }
  })

  ipcMain.handle(
    "storage:secure:set-tokens",
    (_event, { serverId, tokens }: { serverId: string; tokens: SecureTokens }) => {
      try {
        const storeKey = `serverTokens.${serverId}`
        const tokenString = JSON.stringify(tokens)

        if (safeStorage.isEncryptionAvailable()) {
          const encrypted = safeStorage.encryptString(tokenString)
          store.set(storeKey, encrypted.toString("base64"))
        } else {
          log.warn("safeStorage not available - storing tokens unencrypted")
          store.set(storeKey, tokenString)
        }

        return { success: true }
      } catch (error) {
        log.error("Failed to store tokens:", error)
        return { success: false }
      }
    }
  )

  ipcMain.handle("storage:secure:get-tokens", (_event, serverId: string) => {
    try {
      const storeKey = `serverTokens.${serverId}`
      const stored = store.get(storeKey) as string | undefined
      if (!stored) return null

      let tokenString: string

      if (safeStorage.isEncryptionAvailable()) {
        const buffer = Buffer.from(stored, "base64")
        tokenString = safeStorage.decryptString(buffer)
      } else {
        tokenString = stored
      }

      return JSON.parse(tokenString) as SecureTokens
    } catch (error) {
      log.error("Failed to retrieve tokens:", error)
      return null
    }
  })

  ipcMain.handle("storage:secure:clear-tokens", (_event, serverId?: string) => {
    try {
      if (serverId) {
        store.delete(`serverTokens.${serverId}` as never)
      } else {
        store.delete("serverTokens" as never)
      }
      return { success: true }
    } catch (error) {
      log.error("Failed to clear tokens:", error)
      return { success: false }
    }
  })

  ipcMain.handle("storage:settings:get-all", () => {
    return store.get("settings")
  })

  ipcMain.handle(
    "storage:settings:set",
    (_event, { key, value }: { key: keyof AppSettings; value: AppSettings[keyof AppSettings] }) => {
      try {
        const settings = store.get("settings")
        store.set("settings", { ...settings, [key]: value })
        return { success: true }
      } catch (error) {
        log.error("Failed to set setting:", error)
        return { success: false }
      }
    }
  )

  ipcMain.handle("storage:settings:clear", () => {
    try {
      store.set("settings", DEFAULT_SETTINGS)
      return { success: true }
    } catch (error) {
      log.error("Failed to clear settings:", error)
      return { success: false }
    }
  })

  ipcMain.handle("storage:servers:get-all", () => {
    return store.get("servers")
  })

  ipcMain.handle("storage:servers:add", (_event, server: ServerEntry) => {
    try {
      const servers = store.get("servers")
      const idx = servers.findIndex((s) => s.id === server.id)
      if (idx === -1) {
        store.set("servers", [...servers, server])
      } else {
        const updated = [...servers]
        updated[idx] = { ...updated[idx], ...server }
        store.set("servers", updated)
      }
      return { success: true }
    } catch (error) {
      log.error("Failed to add server:", error)
      return { success: false }
    }
  })

  ipcMain.handle("storage:servers:remove", (_event, { id }: { id: string }) => {
    try {
      const servers = store.get("servers")
      store.set(
        "servers",
        servers.filter((s) => s.id !== id)
      )
      return { success: true }
    } catch (error) {
      log.error("Failed to remove server:", error)
      return { success: false }
    }
  })

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
