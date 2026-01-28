import { TbOutlineAlertTriangle, TbOutlineChevronDown, TbOutlinePlus } from "solid-icons/tb"
import { type Component, For, Show } from "solid-js"
import { useConnection, useServers, useSession } from "../../stores/core"
import { useUI } from "../../stores/ui"

const ServerDropdown: Component = () => {
  const { servers, activeServer, activeServerId, setActiveServer } = useServers()
  const {
    serverDropdownOpen,
    toggleServerDropdown,
    closeServerDropdown,
    showConfirmDialog,
    closeConfirmDialog
  } = useUI()
  const { localVoice, leaveVoice } = useSession()
  const { isServerUnavailable, triggerAddServer } = useConnection()

  const handleServerSelect = async (serverId: string) => {
    if (activeServerId() === serverId) return

    // If in voice, show confirmation
    if (localVoice().inVoice) {
      closeServerDropdown()
      showConfirmDialog({
        title: "Leave Voice Call?",
        message: "Switching servers will disconnect you from the voice call.",
        confirmLabel: "Leave & Switch",
        cancelLabel: "Stay",
        variant: "warning",
        onConfirm: async () => {
          leaveVoice()
          await setActiveServer(serverId)
          closeConfirmDialog()
        }
      })
      return
    }

    // Normal switch
    await setActiveServer(serverId)
    closeServerDropdown()
  }

  return (
    <div class="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggleServerDropdown()
        }}
        class="flex items-center gap-2 px-3 py-2 rounded hover:bg-surface-elevated transition-colors max-w-[200px]"
      >
        <span class="font-medium text-sm text-text-primary truncate">
          {activeServer()?.name || "Select Server"}
        </span>
        <Show when={isServerUnavailable()}>
          <span
            class="flex items-center gap-1 text-xs text-error"
            title="Server unavailable - reconnecting..."
          >
            <TbOutlineAlertTriangle class="w-3.5 h-3.5" />
          </span>
        </Show>
        <TbOutlineChevronDown
          class={`w-4 h-4 flex-shrink-0 text-text-secondary transition-transform ${serverDropdownOpen() ? "rotate-180" : ""}`}
        />
      </button>

      <Show when={serverDropdownOpen()}>
        <div class="absolute top-full left-0 mt-1 w-56 bg-surface-elevated rounded-lg shadow-lg border border-border z-50">
          <div class="border-b border-border py-1">
            <button
              type="button"
              onClick={() => {
                closeServerDropdown()
                triggerAddServer()
              }}
              class="w-full px-4 py-2 text-left hover:bg-surface transition-colors flex items-center gap-2"
            >
              <TbOutlinePlus class="w-4 h-4" />
              Add Server
            </button>
          </div>
          <div class="py-1">
            <For each={servers()}>
              {(server) => (
                <button
                  type="button"
                  onClick={() => handleServerSelect(server.id)}
                  class={`w-full px-4 py-2 text-left hover:bg-surface transition-colors truncate ${
                    server.id === activeServer()?.id
                      ? "text-accent bg-surface"
                      : "text-text-primary"
                  }`}
                >
                  {server.name}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

export default ServerDropdown
