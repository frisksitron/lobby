import { createSignal } from "solid-js"

export type ModalType = "settings" | "server-settings" | null

export interface ConfirmDialogConfig {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "danger" | "warning"
  onConfirm: () => void
}

const [activeModal, setActiveModal] = createSignal<ModalType>(null)
const [serverDropdownOpen, setServerDropdownOpen] = createSignal(false)
const [confirmDialog, setConfirmDialog] = createSignal<ConfirmDialogConfig | null>(null)

export function useUI() {
  return {
    activeModal,
    openModal: (modal: ModalType) => setActiveModal(modal),
    closeModal: () => setActiveModal(null),

    serverDropdownOpen,
    toggleServerDropdown: () => setServerDropdownOpen((prev) => !prev),
    closeServerDropdown: () => setServerDropdownOpen(false),

    confirmDialog,
    showConfirmDialog: (config: ConfirmDialogConfig) => setConfirmDialog(config),
    closeConfirmDialog: () => setConfirmDialog(null)
  }
}
