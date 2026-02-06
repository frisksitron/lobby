import { createSignal } from "solid-js"

export interface ConfirmDialogConfig {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "danger" | "warning"
  onConfirm: () => void
}

const [serverDropdownOpen, setServerDropdownOpen] = createSignal(false)
const [confirmDialog, setConfirmDialog] = createSignal<ConfirmDialogConfig | null>(null)

export function useUI() {
  return {
    serverDropdownOpen,
    toggleServerDropdown: () => setServerDropdownOpen((prev) => !prev),
    closeServerDropdown: () => setServerDropdownOpen(false),

    confirmDialog,
    showConfirmDialog: (config: ConfirmDialogConfig) => setConfirmDialog(config),
    closeConfirmDialog: () => setConfirmDialog(null)
  }
}
