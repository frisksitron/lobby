import type { Component } from "solid-js"
import Avatar from "./Avatar"

interface UserIdentityProps {
  name: string
  avatarUrl?: string
  status?: "online" | "idle" | "dnd" | "offline"
  size?: "sm" | "md" | "lg"
  speaking?: boolean // VAD ring - only for voice members
  nameClass?: string // Optional override for name styling
}

const UserIdentity: Component<UserIdentityProps> = (props) => {
  const size = () => props.size || "md"
  const nameClass = () => props.nameClass || "text-sm"

  return (
    <div class="flex items-center gap-3 min-w-0">
      <Avatar
        name={props.name}
        imageUrl={props.avatarUrl}
        status={props.status}
        size={size()}
        speaking={props.speaking}
      />
      <span class={`text-text-primary truncate ${nameClass()}`}>{props.name}</span>
    </div>
  )
}

export default UserIdentity
