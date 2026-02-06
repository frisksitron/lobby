import { createSignal } from "solid-js"
import type { AppSettings, NoiseSuppressionAlgorithm } from "../../../shared/types"
import { createLogger } from "../lib/logger"

const log = createLogger("Settings")

// Default settings (mirrors main process defaults)
const DEFAULT_SETTINGS: AppSettings = {
  inputDevice: "default",
  outputDevice: "default",
  lastActiveServerId: null,
  noiseSuppression: "rnnoise",
  themeId: "discord",
  userVolumes: {},
  echoCancellation: false,
  compressor: true
}

export type { AppSettings, NoiseSuppressionAlgorithm }

// Reactive settings signal
const [settings, setSettings] = createSignal<AppSettings>(DEFAULT_SETTINGS)
const [isLoading, setIsLoading] = createSignal(true)

// Load settings from electron-store via IPC
const loadSettings = async (): Promise<void> => {
  setIsLoading(true)
  try {
    const stored = await window.api.settings.getAll()
    // Merge with defaults to handle missing fields from older settings
    setSettings({ ...DEFAULT_SETTINGS, ...stored })
  } catch (error) {
    log.error("Failed to load settings:", error)
  } finally {
    setIsLoading(false)
  }
}

// Update a single setting
const updateSetting = async <K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> => {
  // Optimistic update
  setSettings((prev) => ({ ...prev, [key]: value }))

  // Persist via IPC
  try {
    await window.api.settings.set(key, value)
  } catch (error) {
    log.error(`Failed to save setting ${key}:`, error)
    // Could revert optimistic update here if needed
  }
}

// Reset all settings to defaults
const resetSettings = async (): Promise<void> => {
  setSettings(DEFAULT_SETTINGS)
  try {
    await window.api.settings.clear()
  } catch (error) {
    log.error("Failed to reset settings:", error)
  }
}

// Get volume for a specific user (0-200, defaults to 100)
const getUserVolume = (userId: string): number => {
  return settings().userVolumes[userId] ?? 100
}

// Set volume for a specific user (0-200)
const setUserVolume = async (userId: string, volume: number): Promise<void> => {
  const clampedVolume = Math.max(0, Math.min(200, Math.round(volume)))
  const newVolumes = { ...settings().userVolumes, [userId]: clampedVolume }

  // Optimistic update
  setSettings((prev) => ({ ...prev, userVolumes: newVolumes }))

  // Persist via IPC
  try {
    await window.api.settings.set("userVolumes", newVolumes)
  } catch (error) {
    log.error(`Failed to save user volume for ${userId}:`, error)
  }
}

export { loadSettings }

export function useSettings() {
  return {
    settings,
    isLoading,
    loadSettings,
    updateSetting,
    resetSettings,
    getUserVolume,
    setUserVolume
  }
}
