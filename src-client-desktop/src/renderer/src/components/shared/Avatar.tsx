import { type Component, Show } from "solid-js"
import { useTheme } from "../../stores/theme"

interface AvatarProps {
  name: string
  imageUrl?: string
  size?: "sm" | "md" | "lg"
  status?: "online" | "idle" | "dnd" | "offline"
  showStatus?: boolean
  speaking?: boolean
}

const sizeClasses = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base"
}

const statusColors = {
  online: "bg-success",
  idle: "bg-warning",
  dnd: "bg-error",
  offline: "bg-text-secondary"
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

const Avatar: Component<AvatarProps> = (props) => {
  const { getAvatarColor } = useTheme()
  const size = () => props.size || "md"
  const showStatus = () => props.showStatus ?? true

  return (
    <div class="relative inline-block">
      <Show
        when={props.imageUrl}
        fallback={
          <div
            class={`${sizeClasses[size()]} rounded-full flex items-center justify-center font-semibold text-white ${props.speaking ? "ring-2 ring-success" : ""}`}
            style={{ "background-color": getAvatarColor(props.name) }}
          >
            {getInitials(props.name)}
          </div>
        }
      >
        <img
          src={props.imageUrl}
          alt={props.name}
          class={`${sizeClasses[size()]} rounded-full object-cover ${props.speaking ? "ring-2 ring-success" : ""}`}
        />
      </Show>
      <Show when={showStatus() && props.status}>
        <div
          class={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-surface ${statusColors[props.status || "offline"]}`}
        />
      </Show>
    </div>
  )
}

export default Avatar
