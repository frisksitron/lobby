import { TbOutlineAlertTriangle, TbOutlineSettings, TbOutlineUser } from "solid-icons/tb"
import { type Component, createEffect, createSignal, onCleanup, Show } from "solid-js"
import { useConnection } from "../../stores/connection"
import { useServers } from "../../stores/servers"
import { useStatus } from "../../stores/status"
import { useUI } from "../../stores/ui"
import ButtonWithIcon from "../shared/ButtonWithIcon"
import ServerDropdown from "./ServerDropdown"
import StatusPanel from "./StatusPanel"

const Header: Component = () => {
  const { openModal } = useUI()
  const { isConnected } = useConnection()
  const { activeServerId } = useServers()
  const { hasActiveIssues } = useStatus()
  const [statusPanelOpen, setStatusPanelOpen] = createSignal(false)

  // Only show Account button when authenticated and a server is selected
  const canShowAccount = () => isConnected() && activeServerId()

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
              label="Issues"
              onClick={() => setStatusPanelOpen((prev) => !prev)}
            />
            <Show when={statusPanelOpen()}>
              <StatusPanel onClose={() => setStatusPanelOpen(false)} />
            </Show>
          </div>
        </Show>
        <Show when={canShowAccount()}>
          <ButtonWithIcon
            icon={<TbOutlineUser class="w-5 h-5" />}
            label="Account"
            onClick={() => openModal("server-settings")}
          />
        </Show>
        <ButtonWithIcon
          icon={<TbOutlineSettings class="w-5 h-5" />}
          label="Settings"
          onClick={() => openModal("settings")}
        />
      </div>
    </header>
  )
}

export default Header
