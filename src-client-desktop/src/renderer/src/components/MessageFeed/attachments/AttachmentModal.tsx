import { TbOutlineX } from "solid-icons/tb"
import { type Component, createEffect, createSignal, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import type { MessageAttachment } from "../../../../../shared/types"
import { formatBytes } from "../../../lib/files"
import { useModalKeyboard } from "../../shared/useModalKeyboard"
import { getAttachmentViewerKind, toDownloadURL, toTrustedPdfSource } from "./attachmentKinds"

interface AttachmentModalProps {
  attachment: MessageAttachment
  onClose: () => void
}

const AttachmentModal: Component<AttachmentModalProps> = (props) => {
  let modalRef: HTMLDivElement | undefined
  const viewerKind = () => getAttachmentViewerKind(props.attachment)
  const downloadURL = () => toDownloadURL(props.attachment.url)

  const [pdfObjectURL, setPdfObjectURL] = createSignal<string | null>(null)
  const [pdfLoading, setPdfLoading] = createSignal(false)
  const [pdfError, setPdfError] = createSignal<string | null>(null)
  let currentPdfObjectURL: string | null = null

  const clearPdfObjectURL = () => {
    if (currentPdfObjectURL) {
      URL.revokeObjectURL(currentPdfObjectURL)
      currentPdfObjectURL = null
    }
    setPdfObjectURL(null)
  }

  createEffect(() => {
    const kind = viewerKind()
    const sourceUrl = props.attachment.url

    clearPdfObjectURL()
    setPdfError(null)

    if (kind !== "pdf") {
      setPdfLoading(false)
      return
    }

    const trustedSource = toTrustedPdfSource(sourceUrl)
    if (!trustedSource) {
      setPdfLoading(false)
      setPdfError("Preview unavailable for untrusted source.")
      return
    }

    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    setPdfLoading(true)

    void (async () => {
      try {
        const response = await fetch(trustedSource)
        if (!response.ok) {
          throw new Error("Failed to load PDF preview.")
        }

        const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? ""
        if (!contentType.startsWith("application/pdf")) {
          throw new Error("This file is not a PDF.")
        }

        const blob = await response.blob()
        if (cancelled) return

        currentPdfObjectURL = URL.createObjectURL(blob)
        setPdfObjectURL(currentPdfObjectURL)
      } catch (error) {
        if (cancelled) return
        setPdfError(error instanceof Error ? error.message : "Failed to load PDF preview.")
      } finally {
        if (!cancelled) {
          setPdfLoading(false)
        }
      }
    })()
  })

  onCleanup(() => {
    clearPdfObjectURL()
  })

  const { handleKeyDown, handleBackdropClick } = useModalKeyboard({
    isOpen: () => true,
    onClose: props.onClose,
    containerRef: () => modalRef
  })

  return (
    <Portal>
      <div
        ref={modalRef}
        class="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4"
        onClick={handleBackdropClick}
        onKeyDown={handleKeyDown}
      >
        <div class="w-[min(92vw,1120px)] max-h-[90vh] flex flex-col">
          <div class="mb-2 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm text-white truncate">{props.attachment.name}</div>
              <div class="text-xs text-white/70">
                {props.attachment.mimeType} • {formatBytes(props.attachment.size)}
              </div>
            </div>
            <div class="flex items-center gap-2">
              <a
                href={downloadURL()}
                download={props.attachment.name}
                class="rounded border border-white/20 px-2.5 py-1.5 text-xs text-white/90 hover:bg-white/10 transition-colors"
              >
                Download
              </a>
              <button
                type="button"
                onClick={props.onClose}
                class="rounded p-1.5 text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Close preview"
              >
                <TbOutlineX class="w-5 h-5" />
              </button>
            </div>
          </div>

          <Show when={viewerKind() === "image"}>
            <img
              src={props.attachment.url}
              alt={props.attachment.name}
              class="w-full max-h-[82vh] object-contain rounded border border-white/15 bg-black"
            />
          </Show>

          <Show when={viewerKind() === "video"}>
            <video
              src={props.attachment.url}
              controls
              preload="metadata"
              class="w-full max-h-[82vh] rounded border border-white/15 bg-black"
            >
              <track kind="captions" />
            </video>
          </Show>

          <Show when={viewerKind() === "audio"}>
            <div class="w-full rounded border border-white/15 bg-black/60 p-6">
              <audio src={props.attachment.url} controls preload="metadata" class="w-full">
                <track kind="captions" />
              </audio>
            </div>
          </Show>

          <Show when={viewerKind() === "pdf"}>
            <div class="w-[min(92vw,1120px)] h-[80vh] rounded border border-white/15 bg-white overflow-hidden">
              <Show when={pdfLoading()}>
                <div class="h-full flex items-center justify-center text-sm text-text-secondary">
                  Loading PDF...
                </div>
              </Show>
              <Show when={!pdfLoading() && pdfError()}>
                {(message) => (
                  <div class="h-full flex items-center justify-center px-4 text-sm text-text-secondary">
                    {message()}
                  </div>
                )}
              </Show>
              <Show when={!pdfLoading() && !pdfError() && pdfObjectURL()}>
                {(objectUrl) => (
                  <iframe
                    src={objectUrl()}
                    title={props.attachment.name}
                    class="h-full w-full bg-white"
                  />
                )}
              </Show>
            </div>
          </Show>

          <Show when={viewerKind() === "none"}>
            <div class="w-full rounded border border-white/15 bg-black/60 p-6">
              <div class="text-sm text-white">No preview available for this file type.</div>
              <div class="mt-1 text-xs text-white/70">
                Use Download to save and open it locally.
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Portal>
  )
}

export default AttachmentModal
