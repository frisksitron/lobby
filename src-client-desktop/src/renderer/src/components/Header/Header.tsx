import { TbSettings, TbUser } from "solid-icons/tb"
import { type Component, Show } from "solid-js"
import { useConnection, useServers } from "../../stores/connection"
import { useUI } from "../../stores/ui"
import ButtonWithIcon from "../shared/ButtonWithIcon"
import ServerDropdown from "./ServerDropdown"

const Header: Component = () => {
  const { openModal } = useUI()
  const { isConnected } = useConnection()
  const { activeServerId } = useServers()

  // Only show Account button when authenticated and a server is selected
  const canShowAccount = () => isConnected() && activeServerId()

  return (
    <header class="h-14 bg-surface border-b border-border flex items-center justify-between px-4">
      <ServerDropdown />

      <div class="flex items-center gap-2">
        <Show when={canShowAccount()}>
          <ButtonWithIcon
            icon={<TbUser class="w-5 h-5" />}
            label="Account"
            onClick={() => openModal("server-settings")}
          />
        </Show>
        <ButtonWithIcon
          icon={<TbSettings class="w-5 h-5" />}
          label="Settings"
          onClick={() => openModal("settings")}
        />
      </div>
    </header>
  )
}

export default Header
