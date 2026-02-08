import { type Component, Show } from "solid-js"
import type { Message as MessageType } from "../../../../shared/types"
import { sanitizeHtml } from "../../lib/sanitize"
import { useUsers } from "../../stores/users"
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
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  })
}

const MessageContent: Component<{ content: string }> = (props) => {
  return (
    <div
      class="message-content text-text-primary break-words"
      innerHTML={sanitizeHtml(props.content)}
    />
  )
}

const Message: Component<MessageProps> = (props) => {
  const { getUserById } = useUsers()
  const isFirstInGroup = () => props.isFirstInGroup ?? true
  const author = () => getUserById(props.message.authorId)

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
          <div class="flex items-baseline gap-3">
            <span class="w-10 shrink-0 text-xs text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity text-right">
              {formatShortTime(props.message.timestamp)}
            </span>
            <MessageContent content={props.message.content} />
          </div>
        }
      >
        <div class="flex items-center gap-2">
          <UserIdentity
            name={props.message.authorName}
            avatarUrl={props.message.authorAvatarUrl}
            status={author()?.status}
            size="md"
          />
          <span class="text-xs text-text-secondary">
            {formatTimestamp(props.message.timestamp)}
          </span>
        </div>
        <div class="ml-13">
          <MessageContent content={props.message.content} />
        </div>
      </Show>
    </div>
  )
}

export default Message
