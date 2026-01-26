import { type Component, createSignal } from "solid-js"
import { TYPING_THROTTLE_MS } from "../../lib/constants/ui"
import { useConnection, useServers, useSession } from "../../stores/core"
import { useMessages } from "../../stores/messages"

const MessageInput: Component = () => {
  const [inputValue, setInputValue] = createSignal("")
  const { sendMessage } = useMessages()
  const { activeServerId, activeServer } = useServers()
  const { sendTyping } = useSession()
  const { isServerUnavailable } = useConnection()

  let lastTypingSent = 0
  let textareaRef: HTMLTextAreaElement | undefined

  const isDisabled = () => isServerUnavailable()

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    const content = inputValue()
    const serverId = activeServerId()

    // Check if content has non-whitespace characters
    if (content.trim() && serverId) {
      sendMessage(serverId, content)
      setInputValue("")
      // Reset textarea height
      if (textareaRef) {
        textareaRef.style.height = "auto"
      }
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleInput = (e: InputEvent) => {
    const target = e.currentTarget as HTMLTextAreaElement
    setInputValue(target.value)

    // Auto-resize textarea
    target.style.height = "auto"
    const borderHeight = target.offsetHeight - target.clientHeight
    target.style.height = `${Math.min(target.scrollHeight + borderHeight, 200)}px`

    // Send typing indicator (throttled)
    const now = Date.now()
    if (target.value.length > 0 && now - lastTypingSent > TYPING_THROTTLE_MS) {
      lastTypingSent = now
      sendTyping()
    }
  }

  const getPlaceholder = () => {
    if (isDisabled()) {
      return "Server unavailable..."
    }
    return `Message ${activeServer()?.name || "channel"}...`
  }

  return (
    <div class="p-4 border-t border-border overflow-hidden">
      <form onSubmit={handleSubmit} class="min-w-0">
        <textarea
          ref={textareaRef}
          value={inputValue()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={getPlaceholder()}
          disabled={isDisabled()}
          rows={1}
          class="w-full min-h-[38px] bg-surface-elevated border border-border rounded-lg px-4 py-2 text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed resize-none overflow-y-auto"
        />
      </form>
    </div>
  )
}

export default MessageInput
