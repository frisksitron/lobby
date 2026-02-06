import { TbOutlineAlertTriangle, TbOutlineWifiOff } from "solid-icons/tb"
import { type Component, Match, Show, Switch } from "solid-js"
import Button from "../components/shared/Button"
import {
  CONNECTION_MESSAGES,
  CONNECTION_STATUS,
  type ConnectionStatusInfo
} from "../lib/constants/connection"
import { useConnection } from "../stores/connection"

const Spinner: Component = () => (
  <div class="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
)

const ConnectionStatusView: Component = () => {
  const connection = useConnection()

  const serverName = () => connection.currentServer()?.name ?? "Server"
  const serverUrl = () => connection.currentServer()?.url ?? ""

  const statusInfo = (): ConnectionStatusInfo => {
    const detail = connection.connectionDetail()
    const state = connection.connectionState()

    if (detail.status === "offline") {
      return CONNECTION_STATUS.offline
    }

    if (state === "connecting" && detail.reconnectAttempt === undefined) {
      return CONNECTION_STATUS.connecting
    }

    if (detail.status === "reconnecting" || detail.reconnectAttempt !== undefined) {
      const attempt = (detail.reconnectAttempt ?? 0) + 1
      const maxAttempts = detail.maxReconnectAttempts ?? 10

      if (attempt > maxAttempts) {
        return CONNECTION_STATUS.maxRetries(maxAttempts)
      }

      return CONNECTION_STATUS.reconnecting
    }

    if (detail.status === "unavailable" || state === "failed") {
      return CONNECTION_STATUS.unavailable
    }

    return CONNECTION_STATUS.connecting
  }

  const Icon: Component = () => {
    const info = statusInfo()
    return (
      <Switch>
        <Match when={info.type === "offline"}>
          <TbOutlineWifiOff class="w-8 h-8 text-error" />
        </Match>
        <Match when={info.type === "max_retries" || info.type === "unavailable"}>
          <TbOutlineAlertTriangle class="w-8 h-8 text-warning" />
        </Match>
        <Match when={true}>
          <Spinner />
        </Match>
      </Switch>
    )
  }

  const countdown = () => connection.countdownSeconds()

  return (
    <div class="flex-1 flex items-center justify-center p-4">
      <div class="bg-surface rounded-lg shadow-xl max-w-md w-full p-6">
        <div class="flex flex-col items-center space-y-6">
          <Icon />

          <div class="text-center space-y-1">
            <p class="font-medium text-text-primary">{serverName()}</p>
            <p class="text-sm text-text-secondary truncate max-w-xs">{serverUrl()}</p>
          </div>

          <p class="text-sm text-text-secondary text-center">
            {statusInfo().message}
            <Show when={statusInfo().showCountdown}>
              <br />
              <Show when={(countdown() ?? 0) > 0} fallback={CONNECTION_MESSAGES.reconnecting}>
                {CONNECTION_MESSAGES.retrying(countdown() ?? 0)}
              </Show>
            </Show>
          </p>

          <Show when={statusInfo().showRetry}>
            <div class="pt-2">
              <Button variant="primary" onClick={() => connection.retryNow()}>
                Retry Now
              </Button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}

export default ConnectionStatusView
