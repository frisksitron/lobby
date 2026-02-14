import type { SettingsTab } from "../../../../shared/types"

export const SETTINGS_TABS = [
  { id: "account", label: "Account" },
  { id: "server", label: "Server" },
  { id: "voice", label: "Voice" },
  { id: "appearance", label: "Appearance" },
  { id: "about", label: "About" }
] as const satisfies ReadonlyArray<{ id: SettingsTab; label: string }>

const SETTINGS_TAB_IDS = new Set<string>(SETTINGS_TABS.map((tab) => tab.id))

export const DEFAULT_SETTINGS_TAB: SettingsTab = "account"

export const isSettingsTab = (tab: string | null | undefined): tab is SettingsTab =>
  typeof tab === "string" && SETTINGS_TAB_IDS.has(tab)

export const resolveSettingsTab = (tab: string | null | undefined): SettingsTab =>
  isSettingsTab(tab) ? tab : DEFAULT_SETTINGS_TAB
