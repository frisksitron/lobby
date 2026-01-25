import { type Component, Show } from "solid-js"
import { Portal } from "solid-js/web"
import Button from "./Button"
import { useModalKeyboard } from "./useModalKeyboard"

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "danger" | "warning"
  onConfirm: () => void
  onCancel: () => void
}

const ConfirmDialog: Component<ConfirmDialogProps> = (props) => {
  let dialogRef: HTMLDivElement | undefined

  const { handleKeyDown, handleBackdropClick } = useModalKeyboard({
    isOpen: () => props.isOpen,
    onClose: () => props.onCancel(),
    containerRef: () => dialogRef
  })

  const confirmVariant = () => (props.variant === "danger" ? "danger" : "primary")

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div
          ref={dialogRef}
          class="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]"
          onClick={handleBackdropClick}
          onKeyDown={handleKeyDown}
        >
          <div class="bg-surface rounded-lg shadow-xl max-w-sm w-full mx-4 max-h-[90vh] flex flex-col">
            <div class="p-4 overflow-y-auto min-h-0">
              <h2 class="text-lg font-semibold text-text-primary mb-2">{props.title}</h2>
              <p class="text-text-secondary text-sm">{props.message}</p>
            </div>
            <div class="flex justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
              <Button variant="secondary" onClick={props.onCancel}>
                {props.cancelLabel || "Cancel"}
              </Button>
              <Button variant={confirmVariant()} onClick={props.onConfirm}>
                {props.confirmLabel || "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}

export default ConfirmDialog
