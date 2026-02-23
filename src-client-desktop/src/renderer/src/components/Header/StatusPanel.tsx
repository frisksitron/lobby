import { TbOutlineAlertTriangle, TbOutlineX } from "solid-icons/tb"
import { type Component, createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import type { ActiveStatus } from "../../stores/status"
import { getRemainingSeconds, resolveIssue, useStatus } from "../../stores/status"

interface StatusItemProps {
  status: ActiveStatus
}

const StatusItem: Component<StatusItemProps> = (props) => {
  const [remaining, setRemaining] = createSignal<number | null>(null)

  // Update countdown every second for transient statuses
  createEffect(() => {
    if (props.status.expiresAt) {
      const update = () => {
        setRemaining(getRemainingSeconds(props.status))
      }
      update()
      const interval = setInterval(update, 1000)
      onCleanup(() => clearInterval(interval))
    }
  })

  const isTransient = () => props.status.expiresAt !== undefined
  const remainingTime = () => {
    const r = remaining()
    return r !== null && r > 0 ? `${r}s` : null
  }

  return (
    <div class="flex items-start gap-2 px-3 py-2 text-sm">
      <TbOutlineAlertTriangle class="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
      <div class="flex-1 min-w-0">
        <p class="text-text-primary">{props.status.message}</p>
        <Show when={isTransient() && remainingTime()}>
          <p class="text-text-secondary text-xs mt-0.5">{remainingTime()} remaining</p>
        </Show>
      </div>
      <Show when={!isTransient()}>
        <button
          type="button"
          onClick={() => resolveIssue(props.status.code)}
          class="p-0.5 hover:bg-surface rounded transition-colors flex-shrink-0"
          aria-label="Dismiss"
        >
          <TbOutlineX class="w-3.5 h-3.5 text-text-secondary" />
        </button>
      </Show>
    </div>
  )
}

interface StatusPanelProps {
  onClose: () => void
}

const StatusPanel: Component<StatusPanelProps> = (props) => {
  const { hasActiveIssues, activeStatuses } = useStatus()

  // Close on escape key
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose()
    }
  }

  createEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown))
  })

  return (
    <Show when={hasActiveIssues()}>
      <div class="absolute top-full right-0 mt-1 w-72 bg-surface-elevated rounded-lg shadow-lg border border-border z-50">
        <div class="px-3 py-2 border-b border-border">
          <h3 class="text-sm font-medium text-text-primary">Notification Center</h3>
        </div>
        <div class="py-1 max-h-64 overflow-y-auto">
          <For each={activeStatuses()}>{(status) => <StatusItem status={status} />}</For>
        </div>
      </div>
    </Show>
  )
}

export default StatusPanel
