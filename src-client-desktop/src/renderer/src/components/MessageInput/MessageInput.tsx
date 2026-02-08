import type { Component } from "solid-js"
import { TYPING_THROTTLE_MS } from "../../lib/constants/ui"
import { useConnection } from "../../stores/connection"
import { useMessages } from "../../stores/messages"
import { useServers } from "../../stores/servers"
import { useTyping } from "../../stores/typing"
import Editor from "./Editor"

const MessageInput: Component = () => {
  const { sendMessage } = useMessages()
  const { activeServerId } = useServers()
  const { sendTyping } = useTyping()
  const { isServerUnavailable } = useConnection()

  let lastTypingSent = 0

  const handleSend = (html: string) => {
    const serverId = activeServerId()
    if (serverId) {
      sendMessage(serverId, html)
    }
  }

  const handleTyping = () => {
    const now = Date.now()
    if (now - lastTypingSent > TYPING_THROTTLE_MS) {
      lastTypingSent = now
      sendTyping()
    }
  }

  return (
    <div class="px-2 mb-5">
      <Editor
        placeholder="Send a message..."
        disabled={isServerUnavailable()}
        onSend={handleSend}
        onTyping={handleTyping}
      />
    </div>
  )
}

export default MessageInput
