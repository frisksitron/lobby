import { A, useNavigate } from "@solidjs/router"
import { TbOutlineCheck, TbOutlineChevronDown, TbOutlinePlus } from "solid-icons/tb"
import { type Component, For } from "solid-js"
import { useConnection } from "../../stores/connection"
import { useServers } from "../../stores/servers"
import { useTheme } from "../../stores/theme"
import { useUI } from "../../stores/ui"
import { useVoice } from "../../stores/voice"

const ServerIcon: Component<{ name: string; size?: "sm" | "default" }> = (props) => {
  const { getAvatarColor } = useTheme()
  const initial = () => (props.name?.[0] ?? "?").toUpperCase()
  const sizeClass = () => (props.size === "sm" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs")

  return (
    <div
      class={`${sizeClass()} flex-shrink-0 flex items-center justify-center rounded-full font-semibold text-white`}
      style={{ "background-color": getAvatarColor(props.name) }}
    >
      {initial()}
    </div>
  )
}

const ServerDropdown: Component = () => {
  const { servers, activeServer, activeServerId } = useServers()
  const {
    serverDropdownOpen,
    toggleServerDropdown,
    closeServerDropdown,
    showConfirmDialog,
    closeConfirmDialog
  } = useUI()
  const { localVoice, leaveVoice } = useVoice()
  const { triggerAddServer } = useConnection()
  const navigate = useNavigate()

  const handleServerClick = (e: MouseEvent, serverId: string) => {
    if (activeServerId() === serverId) {
      closeServerDropdown()
      return
    }

    if (localVoice().inVoice) {
      e.preventDefault()
      closeServerDropdown()
      showConfirmDialog({
        title: "Leave Voice Call?",
        message: "Switching servers will disconnect you from the voice call.",
        confirmLabel: "Leave & Switch",
        cancelLabel: "Stay",
        variant: "warning",
        onConfirm: () => {
          leaveVoice()
          navigate(`/server/${serverId}`)
          closeConfirmDialog()
        }
      })
      return
    }

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
        class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-elevated/80 transition-colors max-w-72 cursor-pointer"
      >
        <ServerIcon name={activeServer()?.name ?? "?"} size="sm" />
        <span class="font-semibold text-sm text-text-primary truncate">
          {activeServer()?.name || "Select Server"}
        </span>
        <TbOutlineChevronDown
          class={`w-4 h-4 flex-shrink-0 text-text-secondary transition-transform duration-200 ${serverDropdownOpen() ? "rotate-180" : ""}`}
        />
      </button>

      <div
        class={`absolute top-full left-0 mt-1 w-64 bg-surface-elevated rounded-lg shadow-lg border border-border z-50 transition-all duration-150 origin-top-left ${
          serverDropdownOpen() ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
        }`}
      >
        <div class="p-1.5">
          <For each={servers()}>
            {(server) => {
              const isActive = () => server.id === activeServerId()
              return (
                <A
                  href={`/server/${server.id}`}
                  onClick={(e) => handleServerClick(e, server.id)}
                  class={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors cursor-pointer ${
                    isActive()
                      ? "bg-accent/10"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface"
                  }`}
                >
                  <ServerIcon name={server.name} />
                  <span
                    class={`flex-1 truncate text-sm font-medium ${
                      isActive() ? "text-text-primary" : ""
                    }`}
                  >
                    {server.name}
                  </span>
                  {isActive() && <TbOutlineCheck class="w-4 h-4 flex-shrink-0 text-accent" />}
                </A>
              )
            }}
          </For>
        </div>

        <div class="border-t border-border p-1.5">
          <button
            type="button"
            onClick={() => {
              closeServerDropdown()
              navigate("/auth")
              triggerAddServer()
            }}
            class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface transition-colors cursor-pointer"
          >
            <div class="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full border-2 border-dashed border-current opacity-60">
              <TbOutlinePlus class="w-4 h-4" />
            </div>
            <span class="text-sm font-medium">Add Server</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default ServerDropdown
