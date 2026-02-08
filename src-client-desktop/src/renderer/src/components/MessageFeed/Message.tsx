import { type Component, Show } from "solid-js"
import type { Message as MessageType } from "../../../../shared/types"
import { sanitizeHtml } from "../../lib/sanitize"
import { useSettings } from "../../stores/settings"
import { useUsers } from "../../stores/users"
import Avatar from "../shared/Avatar"

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
      class="message-content text-text-primary break-all pr-2"
      innerHTML={sanitizeHtml(props.content)}
    />
  )
}

const Message: Component<MessageProps> = (props) => {
  const { getUserById } = useUsers()
  const { settings } = useSettings()
  const isFirstInGroup = () => props.isFirstInGroup ?? true
  const author = () => getUserById(props.message.authorId)
  const compact = () => settings().compactMode

  return (
    <div
      class="rounded pl-4 hover:bg-surface-elevated/50 transition-colors group"
      classList={{
        "pt-2 pb-0.5": isFirstInGroup() && !compact(),
        "py-1": isFirstInGroup() && compact(),
        "py-0.5": !isFirstInGroup()
      }}
    >
      <Show
        when={!compact()}
        fallback={
          <Show
            when={isFirstInGroup()}
            fallback={
              <div class="flex items-baseline gap-2 pr-3">
                <MessageContent content={props.message.content} />
              </div>
            }
          >
            <div class="pr-3">
              <div class="flex items-baseline gap-2">
                <span class="text-sm font-semibold text-text-primary">
                  {props.message.authorName}
                </span>
                <span class="w-12 shrink-0 text-xs text-text-secondary whitespace-nowrap">
                  {formatTimestamp(props.message.timestamp)}
                </span>
              </div>
              <div class="flex gap-2">
                <MessageContent content={props.message.content} />
              </div>
            </div>
          </Show>
        }
      >
        <Show
          when={isFirstInGroup()}
          fallback={
            <div class="flex items-baseline gap-4">
              <span class="w-12 shrink-0 text-[10px] text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity text-right whitespace-nowrap">
                {formatShortTime(props.message.timestamp)}
              </span>
              <MessageContent content={props.message.content} />
            </div>
          }
        >
          <div class="flex items-start gap-4">
            <div class="flex justify-center w-12 shrink-0">
              <Avatar
                name={props.message.authorName}
                imageUrl={props.message.authorAvatarUrl}
                status={author()?.status}
                size="md"
              />
            </div>
            <div class="min-w-0">
              <div class="flex items-baseline gap-2">
                <span class="text-sm font-semibold text-text-primary">
                  {props.message.authorName}
                </span>
                <span class="text-xs text-text-secondary">
                  {formatTimestamp(props.message.timestamp)}
                </span>
              </div>
              <MessageContent content={props.message.content} />
            </div>
          </div>
        </Show>
      </Show>
    </div>
  )
}

export default Message
