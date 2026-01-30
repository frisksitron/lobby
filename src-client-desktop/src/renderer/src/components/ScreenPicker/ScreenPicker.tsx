import { TbOutlineX } from "solid-icons/tb"
import { type Component, createEffect, createSignal, For, Show } from "solid-js"
import { Portal } from "solid-js/web"
import Button from "../shared/Button"

interface ScreenSource {
  id: string
  name: string
  thumbnail: string
}

interface ScreenPickerProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (sourceId: string) => void
}

const ScreenPicker: Component<ScreenPickerProps> = (props) => {
  const [sources, setSources] = createSignal<ScreenSource[]>([])
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)

  createEffect(() => {
    if (props.isOpen) {
      loadSources()
    }
  })

  const loadSources = async () => {
    setLoading(true)
    try {
      const screenSources = await window.api.screen.getSources()
      setSources(screenSources)
    } catch (err) {
      console.error("Failed to get screen sources:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = () => {
    const id = selectedId()
    if (id) {
      props.onSelect(id)
    }
  }

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

  // Categorize sources into screens and windows
  const screens = () => sources().filter((s) => s.id.startsWith("screen:"))
  const windows = () => sources().filter((s) => s.id.startsWith("window:"))

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={handleBackdropClick}
          onKeyDown={handleKeyDown}
        >
          <div
            class="w-[600px] max-h-[80vh] bg-surface rounded-xl shadow-2xl border border-border overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 class="text-lg font-semibold text-text-primary">Share Your Screen</h2>
              <button
                type="button"
                class="p-1.5 rounded-md hover:bg-surface-elevated transition-colors cursor-pointer"
                onClick={props.onClose}
              >
                <TbOutlineX class="w-5 h-5 text-text-secondary" />
              </button>
            </div>

            <div class="flex-1 overflow-y-auto p-4">
              <Show when={loading()}>
                <div class="flex items-center justify-center py-12">
                  <div class="text-text-secondary">Loading sources...</div>
                </div>
              </Show>

              <Show when={!loading()}>
                <Show when={screens().length > 0}>
                  <h3 class="text-sm font-medium text-text-secondary mb-3">Screens</h3>
                  <div class="grid grid-cols-3 gap-3 mb-6">
                    <For each={screens()}>
                      {(source) => (
                        <button
                          type="button"
                          class="rounded-lg overflow-hidden border-2 transition-all hover:border-accent/50 cursor-pointer"
                          classList={{
                            "border-accent ring-2 ring-accent/30": selectedId() === source.id,
                            "border-border": selectedId() !== source.id
                          }}
                          onClick={() => setSelectedId(source.id)}
                        >
                          <img
                            src={source.thumbnail}
                            alt={source.name}
                            class="w-full aspect-video object-cover bg-background"
                          />
                          <div class="px-2 py-1.5 bg-surface-elevated">
                            <p class="text-xs text-text-primary truncate">{source.name}</p>
                          </div>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>

                <Show when={windows().length > 0}>
                  <h3 class="text-sm font-medium text-text-secondary mb-3">Windows</h3>
                  <div class="grid grid-cols-3 gap-3">
                    <For each={windows()}>
                      {(source) => (
                        <button
                          type="button"
                          class="rounded-lg overflow-hidden border-2 transition-all hover:border-accent/50 cursor-pointer"
                          classList={{
                            "border-accent ring-2 ring-accent/30": selectedId() === source.id,
                            "border-border": selectedId() !== source.id
                          }}
                          onClick={() => setSelectedId(source.id)}
                        >
                          <img
                            src={source.thumbnail}
                            alt={source.name}
                            class="w-full aspect-video object-cover bg-background"
                          />
                          <div class="px-2 py-1.5 bg-surface-elevated">
                            <p class="text-xs text-text-primary truncate">{source.name}</p>
                          </div>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>

                <Show when={sources().length === 0}>
                  <div class="flex items-center justify-center py-12">
                    <div class="text-text-secondary">No screens or windows available</div>
                  </div>
                </Show>
              </Show>
            </div>

            <div class="flex items-center justify-end gap-3 px-4 py-3 border-t border-border bg-surface-elevated">
              <Button variant="secondary" onClick={props.onClose}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSelect} disabled={!selectedId()}>
                Share
              </Button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}

export default ScreenPicker
