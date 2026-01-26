import { TbOutlineRefresh, TbOutlineVolume } from "solid-icons/tb"
import { type Component, createEffect, createSignal, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import type { User } from "../../../../shared/types"
import { audioManager } from "../../lib/webrtc"
import { useSettings } from "../../stores/settings"
import UserIdentity from "../shared/UserIdentity"
import VolumeSlider from "../shared/VolumeSlider"

interface UserCardProps {
  user: User
  isOpen: boolean
  onClose: () => void
  anchorRect: DOMRect | null
  isCurrentUser: boolean
}

function formatMemberSince(timestamp: string | undefined): string {
  if (!timestamp) return "Unknown"
  const date = new Date(timestamp)
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  })
}

const UserCard: Component<UserCardProps> = (props) => {
  const { getUserVolume, setUserVolume } = useSettings()
  const [volume, setVolume] = createSignal(100)

  // Initialize volume from settings
  createEffect(() => {
    if (props.isOpen && props.user) {
      setVolume(getUserVolume(props.user.id))
    }
  })

  // Handle volume change
  const handleVolumeChange = (newVolume: number): void => {
    setVolume(newVolume)
    audioManager.setUserVolume(props.user.id, newVolume)
    setUserVolume(props.user.id, newVolume)
  }

  // Reset volume to 100%
  const handleResetVolume = (): void => {
    handleVolumeChange(100)
  }

  // Close on outside click
  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      props.onClose()
    }
  }

  // Close on escape
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

  // Calculate position based on anchor
  const cardStyle = () => {
    if (!props.anchorRect) return {}

    // Position to the left of the sidebar
    const left = props.anchorRect.left - 280 - 8 // card width + gap
    const top = Math.max(8, Math.min(props.anchorRect.top, window.innerHeight - 300))

    return {
      position: "fixed" as const,
      left: `${Math.max(8, left)}px`,
      top: `${top}px`
    }
  }

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div class="fixed inset-0 z-50" onClick={handleBackdropClick}>
          <div
            class="w-[280px] bg-surface rounded-lg shadow-xl border border-border overflow-hidden"
            style={cardStyle()}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header with avatar and name */}
            <div class="bg-surface-elevated p-4">
              <UserIdentity
                name={props.user.username}
                avatarUrl={props.user.avatarUrl}
                status={props.user.status}
                size="lg"
                speaking={props.user.voiceSpeaking}
                nameClass="text-lg font-semibold"
              />
              <Show when={props.user.createdAt}>
                <p class="text-xs text-text-secondary mt-2">
                  Member since {formatMemberSince(props.user.createdAt || "")}
                </p>
              </Show>
            </div>

            {/* Volume controls - only shown when user is in voice and not self */}
            <Show when={props.user.inVoice && !props.isCurrentUser}>
              <div class="p-4 border-t border-border">
                <div class="flex items-center gap-2 mb-3">
                  <TbOutlineVolume class="w-4 h-4 text-text-secondary" />
                  <span class="text-sm text-text-secondary">Volume</span>
                  <span class="ml-auto text-sm text-text-primary font-medium">{volume()}%</span>
                  <Show when={volume() !== 100}>
                    <button
                      type="button"
                      onClick={handleResetVolume}
                      class="p-1 rounded hover:bg-surface-elevated transition-colors"
                      title="Reset to 100%"
                    >
                      <TbOutlineRefresh class="w-4 h-4 text-text-secondary" />
                    </button>
                  </Show>
                </div>
                <VolumeSlider value={volume()} onChange={handleVolumeChange} min={0} max={200} />
                <div class="flex justify-between text-xs text-text-secondary mt-1">
                  <span>0%</span>
                  <span>100%</span>
                  <span>200%</span>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  )
}

export default UserCard
