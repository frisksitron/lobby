import {
  TbOutlineArrowsDiagonal,
  TbOutlineArrowsDiagonalMinimize,
  TbOutlineX
} from "solid-icons/tb"
import { type Component, createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import type { User } from "../../../../shared/types"
import { useUsers } from "../../stores/users"

interface StreamViewerProps {
  stream: MediaStream | null
  streamerId: string | null
  isOwnStream?: boolean
  onClose: () => void
  availableStreamers: User[]
  isLocallySharing: boolean
  onSwitchStream: (streamerId: string) => void
  onViewOwnStream: () => void
}

const StreamViewer: Component<StreamViewerProps> = (props) => {
  let videoRef: HTMLVideoElement | undefined
  const { getUserById } = useUsers()
  const [isFullscreen, setIsFullscreen] = createSignal(false)

  // Bind stream to video element
  // Track isFullscreen() so effect re-runs when switching modes (new video element is created)
  createEffect(() => {
    isFullscreen()
    if (videoRef && props.stream) {
      videoRef.srcObject = props.stream
      videoRef.play().catch(() => {})
    }
  })

  // Handle escape key - exits fullscreen first, then closes if already inline
  createEffect(() => {
    if (props.stream) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          if (isFullscreen()) {
            setIsFullscreen(false)
          } else {
            props.onClose()
          }
        }
      }
      document.addEventListener("keydown", handleKeyDown)
      onCleanup(() => document.removeEventListener("keydown", handleKeyDown))
    }
  })

  const streamerName = () => {
    if (props.isOwnStream) return "Your"
    if (!props.streamerId) return "Unknown"
    const user = getUserById(props.streamerId)
    return user?.username ? `${user.username}'s` : "Unknown"
  }

  const toggleFullscreen = () => setIsFullscreen(!isFullscreen())

  // Show switcher when: (streaming AND others streaming) OR (multiple others streaming)
  const showSwitcher = () => {
    const otherStreamers = props.availableStreamers.length
    if (props.isLocallySharing && otherStreamers > 0) return true
    if (!props.isLocallySharing && otherStreamers > 1) return true
    return false
  }

  const StreamSwitcher = () => (
    <Show when={showSwitcher()}>
      <div class="flex items-center gap-1 ml-4 border-l border-border pl-4">
        <Show when={props.isLocallySharing}>
          <button
            type="button"
            class={`px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
              props.isOwnStream
                ? "bg-accent text-white"
                : "bg-surface-hover text-text-secondary hover:text-text-primary"
            }`}
            onClick={props.onViewOwnStream}
          >
            Your Stream
          </button>
        </Show>
        <For each={props.availableStreamers}>
          {(streamer) => (
            <button
              type="button"
              class={`px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                props.streamerId === streamer.id && !props.isOwnStream
                  ? "bg-accent text-white"
                  : "bg-surface-hover text-text-secondary hover:text-text-primary"
              }`}
              onClick={() => props.onSwitchStream(streamer.id)}
            >
              {streamer.username}
            </button>
          )}
        </For>
      </div>
    </Show>
  )

  const HeaderBar = () => (
    <div class="flex items-center justify-between px-4 py-2 bg-surface-elevated">
      <div class="flex items-center gap-3">
        <div class="w-2 h-2 rounded-full bg-error animate-pulse" />
        <span class="text-text-primary font-medium text-sm min-w-32 truncate">
          {streamerName()} Screen
        </span>
        <StreamSwitcher />
      </div>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="p-1.5 rounded-lg hover:bg-surface-hover transition-colors cursor-pointer"
          onClick={toggleFullscreen}
          title={isFullscreen() ? "Exit fullscreen" : "Fullscreen"}
        >
          <Show
            when={isFullscreen()}
            fallback={<TbOutlineArrowsDiagonal class="w-4 h-4 text-text-secondary" />}
          >
            <TbOutlineArrowsDiagonalMinimize class="w-4 h-4 text-text-secondary" />
          </Show>
        </button>
        <button
          type="button"
          class="p-1.5 rounded-lg hover:bg-surface-hover transition-colors cursor-pointer"
          onClick={props.onClose}
          title="Close"
        >
          <TbOutlineX class="w-4 h-4 text-text-secondary" />
        </button>
      </div>
    </div>
  )

  const VideoElement = () => (
    <video ref={videoRef} autoplay muted playsinline class="w-full h-full object-contain" />
  )

  return (
    <Show when={props.stream && props.streamerId}>
      <Show
        when={isFullscreen()}
        fallback={
          <div class="flex flex-col h-[40%] min-h-[200px] max-h-[60%] bg-black rounded-xl ring-1 ring-white/8 overflow-hidden">
            <HeaderBar />
            <div class="flex-1 flex items-center justify-center overflow-hidden">
              <VideoElement />
            </div>
          </div>
        }
      >
        <Portal>
          <div class="fixed inset-0 z-50 bg-black flex flex-col">
            <div class="flex items-center justify-between px-4 py-2 bg-surface-elevated shrink-0">
              <div class="flex items-center gap-3">
                <div class="w-2 h-2 rounded-full bg-error animate-pulse" />
                <span class="text-text-primary font-medium text-sm min-w-32 truncate">
                  {streamerName()} Screen
                </span>
                <StreamSwitcher />
              </div>
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="p-1.5 rounded-lg hover:bg-surface-hover transition-colors cursor-pointer"
                  onClick={toggleFullscreen}
                  title="Exit fullscreen (Esc)"
                >
                  <TbOutlineArrowsDiagonalMinimize class="w-4 h-4 text-text-secondary" />
                </button>
                <button
                  type="button"
                  class="p-1.5 rounded-lg hover:bg-surface-hover transition-colors cursor-pointer"
                  onClick={props.onClose}
                  title="Close"
                >
                  <TbOutlineX class="w-4 h-4 text-text-secondary" />
                </button>
              </div>
            </div>

            <div class="flex-1 flex items-center justify-center overflow-hidden">
              <VideoElement />
            </div>
          </div>
        </Portal>
      </Show>
    </Show>
  )
}

export default StreamViewer
