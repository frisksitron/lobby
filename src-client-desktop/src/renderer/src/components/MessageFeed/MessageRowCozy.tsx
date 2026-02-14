import { type Component, Show } from "solid-js"
import type { Message as MessageType, User } from "../../../../shared/types"
import Avatar from "../shared/Avatar"
import MessageContent from "./MessageContent"
import { formatShortTime, formatTimestamp } from "./messageTime"

interface MessageRowCozyProps {
  message: MessageType
  isFirstInGroup: boolean
  authorName: string
  authorAvatarUrl?: string
  authorStatus?: User["status"]
}

const MessageRowCozy: Component<MessageRowCozyProps> = (props) => {
  return (
    <Show
      when={props.isFirstInGroup}
      fallback={
        <div class="flex w-full items-baseline gap-4">
          <span class="w-12 shrink-0 text-[10px] text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity text-right whitespace-nowrap">
            {formatShortTime(props.message.timestamp)}
          </span>
          <div class="flex-1 min-w-0">
            <MessageContent
              content={props.message.content}
              attachments={props.message.attachments}
              compactMode={false}
            />
          </div>
        </div>
      }
    >
      <div class="flex items-start gap-4">
        <div class="flex justify-center w-12 shrink-0">
          <Avatar
            name={props.authorName}
            imageUrl={props.authorAvatarUrl}
            status={props.authorStatus}
            size="md"
          />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline gap-2">
            <span class="text-sm font-semibold text-text-primary">{props.authorName}</span>
            <span class="text-xs text-text-secondary">
              {formatTimestamp(props.message.timestamp)}
            </span>
          </div>
          <MessageContent
            content={props.message.content}
            attachments={props.message.attachments}
            compactMode={false}
          />
        </div>
      </div>
    </Show>
  )
}

export default MessageRowCozy
