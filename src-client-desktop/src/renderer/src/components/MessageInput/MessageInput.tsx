import { TbOutlineRefresh, TbOutlineX } from "solid-icons/tb"
import { type Component, For, Show } from "solid-js"
import { TYPING_THROTTLE_MS } from "../../lib/constants/ui"
import { formatBytes } from "../../lib/files"
import { useConnection } from "../../stores/connection"
import { useMessages } from "../../stores/messages"
import { useServers } from "../../stores/servers"
import { useTyping } from "../../stores/typing"
import Editor from "./Editor"

const MessageInput: Component = () => {
  const {
    sendMessage,
    draftAttachments,
    addDraftFiles,
    removeDraftAttachment,
    retryDraftAttachment,
    getDraftSendBlockReason
  } = useMessages()
  const { activeServerId } = useServers()
  const { sendTyping } = useTyping()
  const { isServerUnavailable } = useConnection()

  let lastTypingSent = 0
  let fileInputRef: HTMLInputElement | undefined

  const handleSend = (html: string): boolean => {
    const serverId = activeServerId()
    if (!serverId) {
      return false
    }
    return sendMessage(serverId, html)
  }

  const handleTyping = () => {
    const now = Date.now()
    if (now - lastTypingSent > TYPING_THROTTLE_MS) {
      lastTypingSent = now
      sendTyping()
    }
  }

  const handlePickFiles = () => {
    if (isServerUnavailable()) return
    fileInputRef?.click()
  }

  const handleFileInput = (files: FileList | null): void => {
    if (!files || files.length === 0) return
    addDraftFiles(files)
    if (fileInputRef) fileInputRef.value = ""
  }

  return (
    <div class="mb-3">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        class="hidden"
        onChange={(event) => {
          handleFileInput(event.currentTarget.files)
        }}
      />

      <Show when={draftAttachments().length > 0}>
        <div class="mb-2 space-y-1 max-h-36 overflow-y-auto rounded border border-border bg-surface/40 p-2">
          <For each={draftAttachments()}>
            {(attachment) => (
              <div class="flex items-center gap-2 rounded bg-surface-elevated px-2 py-1.5">
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm text-text-primary">{attachment.name}</div>
                  <div class="text-xs text-text-secondary">
                    {formatBytes(attachment.size)}
                    <Show when={attachment.status === "uploading"}> • Uploading...</Show>
                    <Show when={attachment.status === "ready"}> • Ready</Show>
                    <Show when={attachment.status === "failed"}>
                      {` • ${attachment.error || "Upload failed"}`}
                    </Show>
                  </div>
                </div>

                <Show when={attachment.status === "failed"}>
                  <button
                    type="button"
                    onClick={() => retryDraftAttachment(attachment.localId)}
                    class="rounded p-1 text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
                    title="Retry upload"
                  >
                    <TbOutlineRefresh class="w-4 h-4" />
                  </button>
                </Show>

                <button
                  type="button"
                  onClick={() => removeDraftAttachment(attachment.localId)}
                  class="rounded p-1 text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
                  title="Remove attachment"
                >
                  <TbOutlineX class="w-4 h-4" />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={getDraftSendBlockReason()}>
        {(message) => <p class="mb-2 text-xs text-warning">{message()}</p>}
      </Show>

      <Editor
        placeholder="Send a message..."
        disabled={isServerUnavailable()}
        allowEmptySend={draftAttachments().some((attachment) => attachment.status === "ready")}
        onSend={handleSend}
        onTyping={handleTyping}
        onAttachClick={handlePickFiles}
      />
    </div>
  )
}

export default MessageInput
