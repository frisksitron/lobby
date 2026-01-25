import type { Theme } from "../../../../shared/types"
import { DEFAULT_THEME_ID, getThemeById } from "./definitions"

let currentTheme: Theme = getThemeById(DEFAULT_THEME_ID)

// CSS variable name mapping from ThemeColors keys
const COLOR_VAR_MAP: Record<string, string> = {
  background: "--color-background",
  surface: "--color-surface",
  surfaceElevated: "--color-surface-elevated",
  border: "--color-border",
  textPrimary: "--color-text-primary",
  textSecondary: "--color-text-secondary",
  accent: "--color-accent",
  accentHover: "--color-accent-hover",
  success: "--color-success",
  warning: "--color-warning",
  error: "--color-error"
}

function setTheme(themeId: string): void {
  const theme = getThemeById(themeId)
  currentTheme = theme

  const root = document.documentElement
  for (const [key, cssVar] of Object.entries(COLOR_VAR_MAP)) {
    root.style.setProperty(cssVar, theme.colors[key as keyof typeof theme.colors] as string)
  }
}

function getTheme(): Theme {
  return currentTheme
}

function getAvatarColor(index: number): string {
  const colors = currentTheme.colors.avatarColors
  return colors[Math.abs(index) % colors.length]
}

function getAvatarColorFromString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return getAvatarColor(hash)
}

export const themeManager = {
  setTheme,
  getTheme,
  getAvatarColor,
  getAvatarColorFromString
}
