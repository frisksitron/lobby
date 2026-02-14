import { type Component, Show } from "solid-js"
import type { MessageAttachment } from "../../../../../shared/types"
import { formatBytes } from "../../../lib/files"
import { type AttachmentViewerKind, getAttachmentKindLabel } from "./attachmentKinds"

interface AttachmentCardMediaProps {
  attachment: MessageAttachment
  viewerKind: AttachmentViewerKind
  onOpen: () => void
}

const mediaPreviewGradient: Record<AttachmentViewerKind, string> = {
  image: "from-emerald-400/30 via-sky-500/20 to-slate-900/70",
  video: "from-indigo-400/25 via-violet-500/20 to-slate-900/75",
  audio: "from-amber-400/25 via-orange-500/20 to-slate-900/75",
  pdf: "from-rose-400/25 via-red-500/20 to-slate-900/75",
  none: "from-zinc-400/20 via-slate-500/20 to-slate-900/75"
}

const AttachmentCardMedia: Component<AttachmentCardMediaProps> = (props) => {
  const label = () => getAttachmentKindLabel(props.viewerKind)

  return (
    <button
      type="button"
      onClick={props.onOpen}
      class="w-full cursor-pointer text-left rounded-md border border-border bg-surface-elevated/70 hover:bg-surface-elevated transition-colors overflow-hidden"
    >
      <div class="relative aspect-video w-full overflow-hidden bg-black/30">
        <Show
          when={props.attachment.previewUrl}
          fallback={
            <div
              class={`absolute inset-0 bg-gradient-to-br ${mediaPreviewGradient[props.viewerKind]}`}
            />
          }
        >
          {(previewUrl) => (
            <img
              src={previewUrl()}
              alt={props.attachment.name}
              loading="lazy"
              class="absolute inset-0 h-full w-full object-cover"
            />
          )}
        </Show>

        <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
        <div class="absolute right-2 top-2 rounded border border-white/25 bg-black/55 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white/90">
          {label()}
        </div>

        <Show when={props.viewerKind === "video"}>
          <div class="absolute inset-0 flex items-center justify-center">
            <span class="flex h-12 w-12 items-center justify-center rounded-full border border-white/35 bg-black/55 text-white shadow-md">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="h-5 w-5"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </div>
        </Show>
      </div>

      <div class="grid min-h-[52px] content-center gap-0.5 px-3 py-2">
        <div class="truncate text-sm font-medium text-text-primary">{props.attachment.name}</div>
        <div class="truncate text-xs text-text-secondary">
          {props.attachment.mimeType} • {formatBytes(props.attachment.size)}
        </div>
      </div>
    </button>
  )
}

export default AttachmentCardMedia
