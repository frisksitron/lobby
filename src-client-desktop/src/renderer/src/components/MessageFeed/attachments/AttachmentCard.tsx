import { type Component, createMemo, Show } from "solid-js"
import type { MessageAttachment } from "../../../../../shared/types"
import AttachmentCardCompact from "./AttachmentCardCompact"
import AttachmentCardMedia from "./AttachmentCardMedia"
import { getAttachmentViewerKind } from "./attachmentKinds"

interface AttachmentCardProps {
  attachment: MessageAttachment
  compactMode: boolean
  onOpen: () => void
}

const AttachmentCard: Component<AttachmentCardProps> = (props) => {
  const viewerKind = createMemo(() => getAttachmentViewerKind(props.attachment))
  const usesMediaCard = createMemo(
    () => !props.compactMode && (viewerKind() === "image" || viewerKind() === "video")
  )

  return (
    <Show
      when={usesMediaCard()}
      fallback={
        <AttachmentCardCompact
          attachment={props.attachment}
          viewerKind={viewerKind()}
          onOpen={props.onOpen}
        />
      }
    >
      <AttachmentCardMedia
        attachment={props.attachment}
        viewerKind={viewerKind()}
        onOpen={props.onOpen}
      />
    </Show>
  )
}

export default AttachmentCard
