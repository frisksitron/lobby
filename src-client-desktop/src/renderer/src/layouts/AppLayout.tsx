import { type RouteSectionProps, useLocation, useNavigate } from "@solidjs/router"
import { createEffect, Show } from "solid-js"
import Header from "../components/Header/Header"
import { ScreenPicker } from "../components/ScreenPicker"
import ConfirmDialog from "../components/shared/ConfirmDialog"
import { useConnection } from "../stores/connection"
import { useScreenShare } from "../stores/screen-share"
import { useServers } from "../stores/servers"
import { useUI } from "../stores/ui"

const AppLayout = (props: RouteSectionProps) => {
  const connection = useConnection()
  const { activeServerId } = useServers()
  const navigate = useNavigate()
  const location = useLocation()
  const { serverDropdownOpen, closeServerDropdown, confirmDialog, closeConfirmDialog } = useUI()
  const { isPickerOpen, closeScreenPicker, startScreenShare } = useScreenShare()

  // Centralized navigation driven by connection state
  createEffect(() => {
    const state = connection.connectionState()
    const serverId = activeServerId()

    if (state === "needs_auth") {
      navigate("/auth")
    } else if (state === "connected" && serverId) {
      const path = location.pathname
      if (path === "/auth" || path === "/connecting" || path === "/") {
        navigate(`/server/${serverId}`)
      }
    } else if (state !== "disconnected" && !location.pathname.startsWith("/server/")) {
      navigate("/connecting")
    }
  })

  const handleMainClick = () => {
    if (serverDropdownOpen()) {
      closeServerDropdown()
    }
  }

  return (
    <div class="h-screen flex flex-col bg-background" onClick={handleMainClick}>
      <Header />

      <div class="flex-1 flex overflow-hidden">{props.children}</div>

      <Show when={confirmDialog()}>
        {(config) => (
          <ConfirmDialog
            isOpen={true}
            title={config().title}
            message={config().message}
            confirmLabel={config().confirmLabel}
            cancelLabel={config().cancelLabel}
            variant={config().variant}
            onConfirm={config().onConfirm}
            onCancel={closeConfirmDialog}
          />
        )}
      </Show>

      <ScreenPicker
        isOpen={isPickerOpen()}
        onClose={closeScreenPicker}
        onSelect={startScreenShare}
      />
    </div>
  )
}

export default AppLayout
