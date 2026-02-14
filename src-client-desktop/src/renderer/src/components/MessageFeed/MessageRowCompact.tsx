import { type Component, Show } from "solid-js"
import type { Message as MessageType } from "../../../../shared/types"
import MessageContent from "./MessageContent"
import { formatTimestamp } from "./messageTime"

interface MessageRowCompactProps {
  message: MessageType
  isFirstInGroup: boolean
}

const MessageRowCompact: Component<MessageRowCompactProps> = (props) => {
  return (
    <Show
      when={props.isFirstInGroup}
      fallback={
        <div class="flex w-full items-baseline gap-2 pr-3">
          <div class="flex-1 min-w-0">
            <MessageContent
              content={props.message.content}
              attachments={props.message.attachments}
              compactMode
            />
          </div>
        </div>
      }
    >
      <div class="w-full min-w-0 pr-3">
        <div class="flex items-baseline gap-2">
          <span class="text-sm font-semibold text-text-primary">{props.message.authorName}</span>
          <span class="w-12 shrink-0 text-xs text-text-secondary whitespace-nowrap">
            {formatTimestamp(props.message.timestamp)}
          </span>
        </div>
        <div class="flex w-full gap-2">
          <div class="flex-1 min-w-0">
            <MessageContent
              content={props.message.content}
              attachments={props.message.attachments}
              compactMode
            />
          </div>
        </div>
      </div>
    </Show>
  )
}

export default MessageRowCompact
