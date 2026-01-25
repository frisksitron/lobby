import { type Component, Show } from "solid-js"
import type { Message as MessageType } from "../../../../shared/types"
import { getUserById } from "../../stores/users"
import UserIdentity from "../shared/UserIdentity"

interface MessageProps {
  message: MessageType
  isFirstInGroup?: boolean
  isLastInGroup?: boolean
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  if (isToday) {
    return `Today at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = date.toDateString() === yesterday.toDateString()

  if (isYesterday) {
    return `Yesterday at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })
}

function formatShortTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

const Message: Component<MessageProps> = (props) => {
  const author = () => getUserById(props.message.authorId)
  const authorStatus = () => author()?.status ?? "offline"
  const isFirstInGroup = () => props.isFirstInGroup ?? true

  return (
    <div
      class="px-4 hover:bg-surface-elevated/50 transition-colors group"
      classList={{
        "pt-2": isFirstInGroup(),
        "pt-0.5": !isFirstInGroup()
      }}
    >
      <Show
        when={isFirstInGroup()}
        fallback={
          <div class="flex items-center">
            <span class="w-[52px] text-[10px] text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity text-right pr-2">
              {formatShortTime(props.message.timestamp)}
            </span>
            <p class="text-text-primary break-words whitespace-pre-wrap flex-1">
              {props.message.content}
            </p>
          </div>
        }
      >
        <div class="flex items-center gap-2">
          <UserIdentity
            name={author()?.username || "Unknown"}
            avatarUrl={author()?.avatarUrl}
            status={authorStatus()}
            size="md"
            nameClass="font-semibold"
          />
          <span class="text-xs text-text-secondary">
            {formatTimestamp(props.message.timestamp)}
          </span>
        </div>
        <p class="text-text-primary break-words whitespace-pre-wrap ml-[52px]">
          {props.message.content}
        </p>
      </Show>
    </div>
  )
}

export default Message
