import { type Component, createSignal, For, onMount } from "solid-js"
import { type Toast, useUI } from "../../stores/ui"

const variantClasses = {
  error: "bg-error text-white",
  warning: "bg-warning text-white",
  info: "bg-surface-elevated text-text-primary"
}

const ToastItem: Component<{ toast: Toast }> = (props) => {
  const [visible, setVisible] = createSignal(false)

  onMount(() => {
    // Trigger slide-up animation
    requestAnimationFrame(() => setVisible(true))
  })

  return (
    <div
      class={`px-4 py-2 rounded shadow-lg text-sm font-medium transition-all duration-200 ${variantClasses[props.toast.variant]} ${visible() ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}
    >
      {props.toast.message}
    </div>
  )
}

const ToastContainer: Component = () => {
  const { toasts } = useUI()

  return (
    <div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none">
      <For each={toasts()}>{(toast) => <ToastItem toast={toast} />}</For>
    </div>
  )
}

export default ToastContainer
