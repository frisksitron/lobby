import { type Component, createMemo, Show } from "solid-js"
import type { MessageAttachment } from "../../../../shared/types"
import { sanitizeHtml } from "../../lib/sanitize"
import AttachmentList from "./attachments/AttachmentList"

interface MessageContentProps {
  content: string
  attachments?: MessageAttachment[]
  compactMode: boolean
}

const MessageContent: Component<MessageContentProps> = (props) => {
  const hasText = createMemo(() => props.content.trim() !== "")

  return (
    <div class="w-full min-w-0 pr-2">
      <Show when={hasText()}>
        <div
          class="message-content text-text-primary break-all"
          innerHTML={sanitizeHtml(props.content)}
        />
      </Show>
      <AttachmentList
        attachments={props.attachments}
        hasText={hasText()}
        compactMode={props.compactMode}
      />
    </div>
  )
}

export default MessageContent
