import { useLocation, useNavigate } from "@solidjs/router"
import { TbOutlineAlertTriangle, TbOutlineSettings, TbOutlineX } from "solid-icons/tb"
import { type Component, createEffect, createSignal, onCleanup, Show } from "solid-js"
import { DEFAULT_SETTINGS_TAB, isSettingsTab } from "../../lib/constants/settings"
import { useServers } from "../../stores/servers"
import { useSettings } from "../../stores/settings"
import { useStatus } from "../../stores/status"
import ButtonWithIcon from "../shared/ButtonWithIcon"
import ServerDropdown from "./ServerDropdown"
import StatusPanel from "./StatusPanel"

const linkClass =
  "flex items-center gap-2 transition-colors duration-150 cursor-pointer text-text-secondary hover:text-text-primary hover:bg-surface-elevated px-3 py-2 text-sm rounded"

const Header: Component = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { activeServerId } = useServers()
  const { settings, updateSetting } = useSettings()
  const { hasActiveIssues } = useStatus()
  const isOnSettings = () => location.pathname.startsWith("/settings")
  const [statusPanelOpen, setStatusPanelOpen] = createSignal(false)

  const rememberedSettingsTab = () =>
    isSettingsTab(settings().lastSettingsTab) ? settings().lastSettingsTab : DEFAULT_SETTINGS_TAB

  const currentSettingsTab = () => {
    if (!isOnSettings()) return null
    const [, , tab] = location.pathname.split("/")
    return isSettingsTab(tab) ? tab : null
  }

  const handleSettingsClick = () => {
    if (isOnSettings()) {
      const tab = currentSettingsTab()
      if (tab && settings().lastSettingsTab !== tab) {
        void updateSetting("lastSettingsTab", tab)
      }
      navigate(`/server/${activeServerId()}`)
      return
    }

    navigate(`/settings/${rememberedSettingsTab()}`)
  }

  // Close panel when clicking outside
  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest("[data-status-panel]")) {
      setStatusPanelOpen(false)
    }
  }

  createEffect(() => {
    if (statusPanelOpen()) {
      document.addEventListener("click", handleClickOutside)
      onCleanup(() => document.removeEventListener("click", handleClickOutside))
    }
  })

  return (
    <header class="h-14 bg-surface border-b border-border flex items-center justify-between px-4">
      <ServerDropdown />

      <div class="flex items-center gap-2">
        <Show when={hasActiveIssues()}>
          <div class="relative" data-status-panel>
            <ButtonWithIcon
              icon={<TbOutlineAlertTriangle class="w-5 h-5 text-warning" />}
              label="Notifications"
              onClick={() => setStatusPanelOpen((prev) => !prev)}
            />
            <Show when={statusPanelOpen()}>
              <StatusPanel onClose={() => setStatusPanelOpen(false)} />
            </Show>
          </div>
        </Show>
        <button
          type="button"
          onClick={handleSettingsClick}
          class={`${linkClass} ${isOnSettings() ? "bg-surface-elevated text-text-primary" : ""}`}
          title="Settings"
        >
          {isOnSettings() ? <TbOutlineX class="w-5 h-5" /> : <TbOutlineSettings class="w-5 h-5" />}
          <span>Settings</span>
        </button>
      </div>
    </header>
  )
}

export default Header
