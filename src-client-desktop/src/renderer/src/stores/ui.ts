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

export interface Toast {
  id: string
  message: string
  variant: "error" | "warning" | "info"
}

const TOAST_DURATION_MS = 3000

const [activeModal, setActiveModal] = createSignal<ModalType>(null)
const [serverDropdownOpen, setServerDropdownOpen] = createSignal(false)
const [confirmDialog, setConfirmDialog] = createSignal<ConfirmDialogConfig | null>(null)
const [toasts, setToasts] = createSignal<Toast[]>([])

let toastCounter = 0

export function showToast(message: string, variant: Toast["variant"] = "info"): void {
  const id = `toast-${++toastCounter}`
  setToasts((prev) => [...prev, { id, message, variant }])
  setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, TOAST_DURATION_MS)
}

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
    closeConfirmDialog: () => setConfirmDialog(null),

    toasts
  }
}
