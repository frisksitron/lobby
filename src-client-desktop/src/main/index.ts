import { join } from "node:path"
import { electronApp, is, optimizer } from "@electron-toolkit/utils"
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  nativeTheme,
  safeStorage,
  screen,
  shell,
  Tray
} from "electron"
import Store from "electron-store"
import pkg from "electron-updater"

const { autoUpdater } = pkg

import icon from "../../resources/icon.png?asset"
import { createLogger } from "./logger"

// WebRTC/Audio optimizations - prevent background throttling for voice chat
app.commandLine.appendSwitch("disable-background-timer-throttling")
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows")
app.commandLine.appendSwitch("disable-renderer-backgrounding")

// Audio autoplay without user gesture
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required")

// GPU acceleration
app.commandLine.appendSwitch("enable-gpu-rasterization")
app.commandLine.appendSwitch("enable-zero-copy")

// Enable Windows Graphics Capture for better HDR screen sharing
// WGC properly handles HDR color spaces unlike legacy DXGI Duplicator
// Requires Windows 11 24H2+; older systems fall back to DXGI automatically
app.commandLine.appendSwitch("enable-features", "WgcScreenCapturer,WgcWindowCapturer")

const log = createLogger("Main")

interface SecureTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string
}

type NoiseSuppressionAlgorithm = "speex" | "rnnoise" | "none"
type SettingsTab = "account" | "server" | "voice" | "appearance" | "about"

interface AppSettings {
  inputDevice: string
  outputDevice: string
  lastActiveServerId: string | null
  lastSettingsTab: SettingsTab
  noiseSuppression: NoiseSuppressionAlgorithm
  themeId: string
  userVolumes: Record<string, number>
  echoCancellation: boolean
  compressor: boolean
}

interface ServerEntry {
  id: string
  name: string
  url: string
  iconUrl?: string
  uploadMaxBytes?: number
}

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

interface StoreSchema {
  encryptedTokens: string | null
  settings: AppSettings
  servers: ServerEntry[]
  windowBounds: WindowBounds | null
}

const DEFAULT_SETTINGS: AppSettings = {
  inputDevice: "default",
  outputDevice: "default",
  lastActiveServerId: null,
  lastSettingsTab: "account",
  noiseSuppression: "rnnoise",
  themeId: "discord",
  userVolumes: {},
  echoCancellation: false,
  compressor: true
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
    servers: [],
    windowBounds: null
  }
})

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function getValidBounds(): WindowBounds | null {
  const saved = store.get("windowBounds")
  if (!saved) return null

  const displays = screen.getAllDisplays()
  const isOnScreen = displays.some((display) => {
    const { x, y, width, height } = display.bounds
    return saved.x >= x && saved.x < x + width && saved.y >= y && saved.y < y + height
  })

  return isOnScreen ? saved : null
}

function saveBounds(): void {
  if (!mainWindow || mainWindow.isMaximized() || mainWindow.isMinimized()) {
    if (mainWindow?.isMaximized()) {
      const current = store.get("windowBounds")
      if (current) {
        store.set("windowBounds", { ...current, isMaximized: true })
      }
    }
    return
  }
  const bounds = mainWindow.getBounds()
  store.set("windowBounds", { ...bounds, isMaximized: false })
}

function createWindow(): void {
  const savedBounds = getValidBounds()

  mainWindow = new BrowserWindow({
    width: savedBounds?.width ?? 900,
    height: savedBounds?.height ?? 670,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 480,
    minHeight: 400,
    show: false,
    autoHideMenuBar: true,
    title: INSTANCE_ID ? `Lobby (Instance ${INSTANCE_ID})` : "Lobby",
    icon,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false
    }
  })

  mainWindow.on("ready-to-show", () => {
    if (savedBounds?.isMaximized) {
      mainWindow?.maximize()
    }
    mainWindow?.show()
  })

  mainWindow.on("resize", saveBounds)
  mainWindow.on("move", saveBounds)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  // Handle zoom shortcuts directly - fixes Ctrl+= not working on some keyboards
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !input.control || input.alt) return

    if (input.key === "=" || input.key === "+") {
      mainWindow?.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5)
      event.preventDefault()
    } else if (input.key === "-") {
      mainWindow?.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 0.5)
      event.preventDefault()
    } else if (input.key === "0") {
      mainWindow?.webContents.setZoomLevel(0)
      event.preventDefault()
    }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }

  mainWindow.on("close", (event) => {
    event.preventDefault()
    mainWindow?.hide()
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

  ipcMain.handle("theme:set-native", (_event, mode: "light" | "dark") => {
    nativeTheme.themeSource = mode
  })

  // Screen capture sources for screen sharing
  ipcMain.handle("screen:getSources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 150, height: 150 }
    })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL()
    }))
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

  tray = new Tray(icon)
  tray.setToolTip("Lobby")
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show",
        click: () => {
          mainWindow?.show()
        }
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          mainWindow?.destroy()
          app.quit()
        }
      }
    ])
  )
  tray.on("click", () => {
    mainWindow?.show()
  })

  // Auto-updater setup
  autoUpdater.logger = {
    info: (message) => log.info("[AutoUpdater]", message),
    warn: (message) => log.warn("[AutoUpdater]", message),
    error: (message) => log.error("[AutoUpdater]", message),
    debug: (message) => log.debug("[AutoUpdater]", message)
  }

  autoUpdater.on("checking-for-update", () => {
    log.info("Checking for updates...")
    mainWindow?.webContents.send("updater:checking")
  })

  autoUpdater.on("update-available", (info) => {
    log.info("Update available:", info.version)
    mainWindow?.webContents.send("updater:available", {
      version: info.version,
      releaseNotes: info.releaseNotes
    })
  })

  autoUpdater.on("update-not-available", () => {
    log.info("No updates available")
    mainWindow?.webContents.send("updater:not-available")
  })

  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.webContents.send("updater:progress", {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on("update-downloaded", (info) => {
    log.info("Update downloaded:", info.version)
    mainWindow?.webContents.send("updater:downloaded", {
      version: info.version,
      releaseNotes: info.releaseNotes
    })
  })

  autoUpdater.on("error", (err) => {
    log.error("Auto-updater error:", err)
    mainWindow?.webContents.send("updater:error", err.message)
  })

  // IPC handlers for updater
  ipcMain.handle("updater:check", async () => {
    if (is.dev) {
      return { success: false, error: "Updates not available in development mode" }
    }
    try {
      const result = await autoUpdater.checkForUpdates()
      return { success: true, version: result?.updateInfo?.version }
    } catch (error) {
      log.error("Failed to check for updates:", error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle("updater:install", () => {
    autoUpdater.quitAndInstall(false, true)
  })

  if (!is.dev) {
    autoUpdater.checkForUpdatesAndNotify()
  }
})
