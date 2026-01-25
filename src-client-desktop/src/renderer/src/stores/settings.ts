import { createSignal } from "solid-js"
import type { AppSettings, NoiseSuppressionAlgorithm } from "../../../shared/types"
import { createLogger } from "../lib/logger"

const log = createLogger("Settings")

// Type for audio devices
interface AudioDevices {
  inputDevices: MediaDeviceInfo[]
  outputDevices: MediaDeviceInfo[]
}

// Default settings (mirrors main process defaults)
const DEFAULT_SETTINGS: AppSettings = {
  inputDevice: "default",
  outputDevice: "default",
  lastActiveServerId: null,
  noiseSuppression: "rnnoise",
  themeId: "discord",
  userVolumes: {}
}

export type { AppSettings, NoiseSuppressionAlgorithm }

// Reactive settings signal
const [settings, setSettings] = createSignal<AppSettings>(DEFAULT_SETTINGS)
const [isLoading, setIsLoading] = createSignal(true)

// Audio devices signal
const [audioDevices, setAudioDevices] = createSignal<AudioDevices>({
  inputDevices: [],
  outputDevices: []
})

export function useSettings() {
  // Load settings from electron-store via IPC
  const loadSettings = async (): Promise<void> => {
    setIsLoading(true)
    try {
      const stored = await window.api.settings.getAll()
      setSettings(stored)
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

  // Load available audio devices
  const loadAudioDevices = async (): Promise<void> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setAudioDevices({
        inputDevices: devices.filter((d) => d.kind === "audioinput"),
        outputDevices: devices.filter((d) => d.kind === "audiooutput")
      })
    } catch (error) {
      log.error("Failed to enumerate audio devices:", error)
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

  return {
    settings,
    isLoading,
    loadSettings,
    updateSetting,
    resetSettings,
    audioDevices,
    loadAudioDevices,
    getUserVolume,
    setUserVolume
  }
}
