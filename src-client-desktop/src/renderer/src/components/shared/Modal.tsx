import { TbOutlineX } from "solid-icons/tb"
import { type Component, type JSX, Show } from "solid-js"
import { Portal } from "solid-js/web"
import ButtonWithIcon from "./ButtonWithIcon"
import { useModalKeyboard } from "./useModalKeyboard"

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: JSX.Element
  headerContent?: JSX.Element
  footer?: JSX.Element
}

const Modal: Component<ModalProps> = (props) => {
  let modalRef: HTMLDivElement | undefined

  const { handleKeyDown, handleBackdropClick } = useModalKeyboard({
    isOpen: () => props.isOpen,
    onClose: () => props.onClose(),
    containerRef: () => modalRef
  })

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div
          ref={modalRef}
          class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={handleBackdropClick}
          onKeyDown={handleKeyDown}
        >
          <div class="bg-surface rounded-lg shadow-xl max-w-md w-full mx-4 flex flex-col h-[min(40rem,90vh)]">
            <div class={`shrink-0 ${props.headerContent ? "" : "border-b border-border"}`}>
              <div class="flex items-center justify-between px-4 py-3">
                <h2 class="text-lg font-semibold text-text-primary">{props.title}</h2>
                <ButtonWithIcon
                  icon={<TbOutlineX class="w-5 h-5" />}
                  size="sm"
                  onClick={props.onClose}
                  title="Close"
                />
              </div>
              <Show when={props.headerContent}>
                <div class="border-b border-border">{props.headerContent}</div>
              </Show>
            </div>
            <div class="p-4 overflow-y-auto min-h-0 flex-1">{props.children}</div>
            <Show when={props.footer}>
              <div class="px-4 py-3 border-t border-border shrink-0 rounded-b-lg">
                {props.footer}
              </div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  )
}

export default Modal
