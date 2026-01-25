import { type Accessor, createEffect } from "solid-js"

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

interface UseModalKeyboardOptions {
  isOpen: Accessor<boolean>
  onClose: () => void
  containerRef: Accessor<HTMLElement | undefined>
}

/**
 * Hook for modal keyboard handling:
 * - Escape key closes the modal
 * - Tab key is trapped within the modal
 * - Auto-focuses first focusable element when opened
 * - Provides backdrop click handler
 */
export function useModalKeyboard(options: UseModalKeyboardOptions) {
  const { isOpen, onClose, containerRef } = options

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      onClose()
      return
    }

    const container = containerRef()
    if (e.key === "Tab" && container) {
      const focusableElements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusableElements.length === 0) return

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (e.shiftKey) {
        // Shift+Tab: if on first element, go to last
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement?.focus()
        }
      } else {
        // Tab: if on last element, go to first
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement?.focus()
        }
      }
    }
  }

  /**
   * Close modal when clicking on the backdrop (not the content)
   */
  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  // Focus first focusable element when modal opens
  createEffect(() => {
    const container = containerRef()
    if (isOpen() && container) {
      const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      firstFocusable?.focus()
    }
  })

  return { handleKeyDown, handleBackdropClick }
}
