import { createSignal } from "solid-js"
import type { Theme } from "../../../shared/types"
import { createLogger } from "../lib/logger"
import { DEFAULT_THEME_ID, getAvailableThemes, getThemeById, themeManager } from "../lib/themes"

const log = createLogger("ThemeStore")

// Reactive state for current theme
const [currentTheme, setCurrentTheme] = createSignal<Theme>(getThemeById(DEFAULT_THEME_ID))
const [isInitialized, setIsInitialized] = createSignal(false)

export function useTheme() {
  /**
   * Load theme preference from settings and apply it
   */
  const loadTheme = async (): Promise<void> => {
    try {
      const settings = await window.api.settings.getAll()
      const themeId = settings.themeId || DEFAULT_THEME_ID

      // Apply theme via manager (sets CSS variables)
      themeManager.setTheme(themeId)
      setCurrentTheme(getThemeById(themeId))
      setIsInitialized(true)

      log.info("Theme loaded:", themeId)
    } catch (error) {
      log.error("Failed to load theme:", error)
      // Fall back to default theme
      themeManager.setTheme(DEFAULT_THEME_ID)
      setCurrentTheme(getThemeById(DEFAULT_THEME_ID))
      setIsInitialized(true)
    }
  }

  /**
   * Change the current theme and persist preference
   */
  const changeTheme = async (themeId: string): Promise<void> => {
    // Apply theme immediately
    themeManager.setTheme(themeId)
    setCurrentTheme(getThemeById(themeId))

    // Persist to settings
    try {
      await window.api.settings.set("themeId", themeId)
    } catch (error) {
      log.error("Failed to save theme preference:", error)
    }
  }

  /**
   * Get an avatar color based on a name hash
   */
  const getAvatarColor = (name: string): string => {
    return themeManager.getAvatarColorFromString(name)
  }

  return {
    currentTheme,
    isInitialized,
    loadTheme,
    changeTheme,
    getAvatarColor,
    getAvailableThemes
  }
}
