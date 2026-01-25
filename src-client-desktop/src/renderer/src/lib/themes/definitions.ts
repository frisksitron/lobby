import type { Theme } from "../../../../shared/types"

// Discord theme - modern Discord dark theme
export const discordTheme: Theme = {
  id: "discord",
  name: "Discord",
  colors: {
    background: "#1A1A1E", // Main content background
    surface: "#121214", // Sidebar/secondary background
    surfaceElevated: "#222327", // Elevated elements (dropdowns, modals)
    border: "#29292D", // Borders
    textPrimary: "#FBFBFB", // Primary text
    textSecondary: "#b5bac1", // Secondary/muted text
    accent: "#5865f2", // Blurple
    accentHover: "#4752c4", // Blurple hover
    success: "#23a559", // Online/success green
    warning: "#f0b232", // Idle/warning yellow
    error: "#D22D39", // DND/error red
    avatarColors: ["#5865f2", "#57f287", "#fee75c", "#eb459e", "#ed4245", "#f47b67"]
  }
}

// Catppuccin Mocha - Dark theme with warm, pastel tones
export const catppuccinMochaTheme: Theme = {
  id: "catppuccin-mocha",
  name: "Catppuccin Mocha",
  colors: {
    background: "#1e1e2e", // Base - main content
    surface: "#181825", // Mantle - sidebar (darker than base)
    surfaceElevated: "#313244", // Surface0 - elevated elements (modals, dropdowns)
    border: "#313244", // Surface0 - subtle borders
    textPrimary: "#cdd6f4", // Text
    textSecondary: "#a6adc8", // Subtext0 - more muted for secondary
    accent: "#89b4fa", // Blue - good saturation for buttons
    accentHover: "#74a8f9", // Slightly darker blue on hover
    success: "#a6e3a1", // Green
    warning: "#f9e2af", // Yellow
    error: "#f38ba8", // Red
    avatarColors: ["#89b4fa", "#cba6f7", "#f38ba8", "#fab387", "#a6e3a1", "#94e2d5"]
  }
}

// Catppuccin Latte - Light theme with soft, coffee-inspired tones
export const catppuccinLatteTheme: Theme = {
  id: "catppuccin-latte",
  name: "Catppuccin Latte",
  colors: {
    background: "#eff1f5", // Base - main content
    surface: "#e6e9ef", // Mantle - sidebar (slightly muted)
    surfaceElevated: "#ffffff", // White - elevated elements pop out
    border: "#dce0e8", // Surface1 - subtle borders
    textPrimary: "#4c4f69", // Text
    textSecondary: "#6c6f85", // Subtext0 - more muted
    accent: "#1e66f5", // Blue - vibrant, good contrast
    accentHover: "#2a6ff7", // Slightly lighter blue on hover
    success: "#40a02b", // Green
    warning: "#df8e1d", // Yellow
    error: "#d20f39", // Red
    avatarColors: ["#1e66f5", "#8839ef", "#d20f39", "#fe640b", "#40a02b", "#179299"]
  }
}

// All available themes
export const themes: Record<string, Theme> = {
  discord: discordTheme,
  "catppuccin-mocha": catppuccinMochaTheme,
  "catppuccin-latte": catppuccinLatteTheme
}

// Default theme ID
export const DEFAULT_THEME_ID = "discord"

// Get theme by ID (returns default if not found)
export function getThemeById(id: string): Theme {
  return themes[id] || themes[DEFAULT_THEME_ID]
}

// Get list of available themes
export function getAvailableThemes(): Theme[] {
  return Object.values(themes)
}
