import { type Component, createMemo, createSignal, For, Show } from "solid-js"
import type { MessageAttachment } from "../../../../../shared/types"
import AttachmentCard from "./AttachmentCard"
import AttachmentModal from "./AttachmentModal"

interface AttachmentListProps {
  attachments?: MessageAttachment[]
  hasText: boolean
  compactMode: boolean
}

const AttachmentList: Component<AttachmentListProps> = (props) => {
  const [activeAttachment, setActiveAttachment] = createSignal<MessageAttachment | null>(null)
  const attachments = createMemo(() => props.attachments ?? [])

  return (
    <Show when={attachments().length > 0}>
      <div
        class="mb-0.5 w-full max-w-[22rem] space-y-1.5"
        classList={{
          "mt-1": props.hasText,
          "mt-0": !props.hasText
        }}
      >
        <For each={attachments()}>
          {(attachment) => (
            <AttachmentCard
              attachment={attachment}
              compactMode={props.compactMode}
              onOpen={() => setActiveAttachment(attachment)}
            />
          )}
        </For>
      </div>

      <Show when={activeAttachment()}>
        {(attachment) => (
          <AttachmentModal attachment={attachment()} onClose={() => setActiveAttachment(null)} />
        )}
      </Show>
    </Show>
  )
}

export default AttachmentList
