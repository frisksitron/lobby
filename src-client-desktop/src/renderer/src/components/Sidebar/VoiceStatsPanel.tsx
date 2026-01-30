import { type Component, createEffect, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import {
  startStatsCollection,
  stopStatsCollection,
  useVoiceStats,
  webrtcManager
} from "../../lib/webrtc"

interface VoiceStatsPanelProps {
  isOpen: boolean
  onClose: () => void
  anchorRect: DOMRect | null
}

const VoiceStatsPanel: Component<VoiceStatsPanelProps> = (props) => {
  const { stats } = useVoiceStats()

  createEffect(() => {
    if (props.isOpen) {
      const pc = webrtcManager.getPeerConnection()
      if (pc) {
        startStatsCollection(pc)
      }
    } else {
      stopStatsCollection()
    }
  })

  onCleanup(() => {
    stopStatsCollection()
  })

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      props.onClose()
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose()
    }
  }

  createEffect(() => {
    if (props.isOpen) {
      document.addEventListener("keydown", handleKeyDown)
      onCleanup(() => document.removeEventListener("keydown", handleKeyDown))
    }
  })

  const panelStyle = () => {
    if (!props.anchorRect) return {}

    const left = props.anchorRect.left - 220 - 16
    // Reserve more height when video stats are shown
    const reservedHeight = hasVideoStats() ? 350 : 250
    const top = Math.max(
      8,
      Math.min(props.anchorRect.top - 100, window.innerHeight - reservedHeight)
    )

    return {
      position: "fixed" as const,
      left: `${Math.max(8, left)}px`,
      top: `${top}px`
    }
  }

  const formatBitrate = (kbps: number | null): string => {
    if (kbps === null) return "-"
    return `${kbps.toFixed(1)} kbps`
  }

  const formatLatency = (ms: number | null): string => {
    if (ms === null) return "-"
    return `${ms.toFixed(0)} ms`
  }

  const formatJitter = (ms: number | null): string => {
    if (ms === null) return "-"
    return `${ms.toFixed(1)} ms`
  }

  const formatPacketLoss = (percent: number | null): string => {
    if (percent === null) return "-"
    return `${percent.toFixed(2)}%`
  }

  const formatCodec = (): string => {
    const s = stats()
    if (!s?.codec) return "-"
    if (s.clockRate) {
      return `${s.codec} ${(s.clockRate / 1000).toFixed(0)}kHz`
    }
    return s.codec
  }

  const formatVideoBitrate = (kbps: number | null): string => {
    if (kbps === null) return "-"
    if (kbps >= 1000) {
      return `${(kbps / 1000).toFixed(2)} Mbps`
    }
    return `${kbps.toFixed(0)} kbps`
  }

  const hasVideoStats = () => {
    const s = stats()
    return s && (s.videoBitrateIn !== null || s.videoBitrateOut !== null)
  }

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div class="fixed inset-0 z-50" onClick={handleBackdropClick}>
          <div
            class="w-[220px] bg-surface rounded-lg shadow-xl border border-border overflow-hidden"
            style={panelStyle()}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="bg-surface-elevated px-3 py-2 border-b border-border">
              <h3 class="text-sm font-semibold text-text-primary">Stats for nerds</h3>
            </div>

            <div class="p-3 space-y-2 text-xs">
              <div class="flex justify-between">
                <span class="text-text-secondary">Codec</span>
                <span class="text-text-primary font-mono">{formatCodec()}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-text-secondary">Bitrate In</span>
                <span class="text-text-primary font-mono">
                  {formatBitrate(stats()?.bitrateIn ?? null)}
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-text-secondary">Bitrate Out</span>
                <span class="text-text-primary font-mono">
                  {formatBitrate(stats()?.bitrateOut ?? null)}
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-text-secondary">Latency</span>
                <span class="text-text-primary font-mono">
                  {formatLatency(stats()?.rtt ?? null)}
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-text-secondary">Jitter</span>
                <span class="text-text-primary font-mono">
                  {formatJitter(stats()?.jitter ?? null)}
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-text-secondary">Packet Loss</span>
                <span class="text-text-primary font-mono">
                  {formatPacketLoss(stats()?.packetLossPercent ?? null)}
                </span>
              </div>

              <Show when={hasVideoStats()}>
                <div class="border-t border-border pt-2 mt-2 space-y-2">
                  <Show when={stats()?.videoCodec}>
                    <div class="flex justify-between">
                      <span class="text-text-secondary">Video Codec</span>
                      <span class="text-text-primary font-mono">{stats()?.videoCodec}</span>
                    </div>
                  </Show>
                  <Show when={stats()?.videoBitrateIn !== null}>
                    <div class="flex justify-between">
                      <span class="text-text-secondary">Video In</span>
                      <span class="text-text-primary font-mono">
                        {formatVideoBitrate(stats()?.videoBitrateIn ?? null)}
                      </span>
                    </div>
                  </Show>
                  <Show when={stats()?.videoBitrateOut !== null}>
                    <div class="flex justify-between">
                      <span class="text-text-secondary">Video Out</span>
                      <span class="text-text-primary font-mono">
                        {formatVideoBitrate(stats()?.videoBitrateOut ?? null)}
                      </span>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}

export default VoiceStatsPanel
