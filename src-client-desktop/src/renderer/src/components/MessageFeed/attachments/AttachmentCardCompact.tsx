import type { Component } from "solid-js"
import type { MessageAttachment } from "../../../../../shared/types"
import { formatBytes } from "../../../lib/files"
import { type AttachmentViewerKind, getAttachmentKindLabel } from "./attachmentKinds"

interface AttachmentCardCompactProps {
  attachment: MessageAttachment
  viewerKind: AttachmentViewerKind
  onOpen: () => void
}

const compactTileGradient: Record<AttachmentViewerKind, string> = {
  image: "from-emerald-400/30 via-sky-500/20 to-slate-900/70",
  video: "from-indigo-400/25 via-violet-500/20 to-slate-900/75",
  audio: "from-amber-400/25 via-orange-500/20 to-slate-900/75",
  pdf: "from-rose-400/25 via-red-500/20 to-slate-900/75",
  none: "from-zinc-400/20 via-slate-500/20 to-slate-900/75"
}

const AttachmentCardCompact: Component<AttachmentCardCompactProps> = (props) => {
  const label = () => getAttachmentKindLabel(props.viewerKind)

  return (
    <button
      type="button"
      onClick={props.onOpen}
      class="w-full cursor-pointer text-left rounded-md border border-border bg-surface-elevated/70 px-3 py-2 hover:bg-surface-elevated transition-colors"
    >
      <div class="flex items-center gap-2.5">
        <div
          class={`flex h-10 w-10 shrink-0 items-center justify-center rounded border border-white/15 bg-gradient-to-br ${compactTileGradient[props.viewerKind]} text-[10px] font-semibold tracking-wide text-white/90`}
        >
          {label()}
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-text-primary">{props.attachment.name}</div>
          <div class="truncate text-xs text-text-secondary">
            {props.attachment.mimeType} • {formatBytes(props.attachment.size)}
          </div>
        </div>
      </div>
    </button>
  )
}

export default AttachmentCardCompact
