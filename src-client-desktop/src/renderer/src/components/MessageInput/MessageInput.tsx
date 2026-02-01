import { type Component, createSignal } from "solid-js"
import { TYPING_THROTTLE_MS } from "../../lib/constants/ui"
import { useConnection } from "../../stores/connection"
import { useMessages } from "../../stores/messages"
import { useServers } from "../../stores/servers"
import { useTyping } from "../../stores/typing"

const MessageInput: Component = () => {
  const [inputValue, setInputValue] = createSignal("")
  const { sendMessage } = useMessages()
  const { activeServerId, activeServer } = useServers()
  const { sendTyping } = useTyping()
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
    <div class="px-2 mb-5">
      <form onSubmit={handleSubmit} class="min-w-0 flex">
        <textarea
          ref={textareaRef}
          value={inputValue()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={getPlaceholder()}
          disabled={isDisabled()}
          rows={1}
          class="w-full bg-surface-elevated ring-1 ring-border rounded px-4 py-1.5 leading-6 text-text-primary placeholder-text-secondary focus:outline-none focus:ring-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed resize-none overflow-y-auto"
        />
      </form>
    </div>
  )
}

export default MessageInput
