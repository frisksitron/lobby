import type { RouteSectionProps } from "@solidjs/router"
import { Show } from "solid-js"
import Header from "../components/Header/Header"
import { ScreenPicker } from "../components/ScreenPicker"
import ConfirmDialog from "../components/shared/ConfirmDialog"
import { useScreenShare } from "../stores/screen-share"
import { useUI } from "../stores/ui"

const AppLayout = (props: RouteSectionProps) => {
  const { serverDropdownOpen, closeServerDropdown, confirmDialog, closeConfirmDialog } = useUI()
  const { isPickerOpen, closeScreenPicker, startScreenShare } = useScreenShare()

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
