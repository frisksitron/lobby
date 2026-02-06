import { createSignal } from "solid-js"
import type { TypingUser } from "../../../shared/types"
import { connectionService } from "../lib/connection"
import { TYPING_TIMEOUT_MS } from "../lib/constants/ui"
import type { TypingStartPayload, TypingStopPayload } from "../lib/ws"
import { wsManager } from "../lib/ws"

const [typingUsers, setTypingUsers] = createSignal<TypingUser[]>([])
const typingTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

function handleTypingStart(payload: TypingStartPayload): void {
  const userId = connectionService.getUserId()
  if (userId && payload.user_id === userId) return

  const existing = typingTimeouts.get(payload.user_id)
  if (existing) clearTimeout(existing)

  setTypingUsers((prev) => {
    if (prev.some((u) => u.userId === payload.user_id)) return prev
    return [
      ...prev,
      { userId: payload.user_id, username: payload.username, timestamp: payload.timestamp }
    ]
  })

  typingTimeouts.set(
    payload.user_id,
    setTimeout(() => {
      setTypingUsers((prev) => prev.filter((u) => u.userId !== payload.user_id))
      typingTimeouts.delete(payload.user_id)
    }, TYPING_TIMEOUT_MS)
  )
}

function handleTypingStop(payload: TypingStopPayload): void {
  const timeout = typingTimeouts.get(payload.user_id)
  if (timeout) {
    clearTimeout(timeout)
    typingTimeouts.delete(payload.user_id)
  }
  setTypingUsers((prev) => prev.filter((u) => u.userId !== payload.user_id))
}

function clearTypingUsers(): void {
  for (const timeout of typingTimeouts.values()) clearTimeout(timeout)
  typingTimeouts.clear()
  setTypingUsers([])
}

function sendTyping(): void {
  if (connectionService.getSession()?.status === "connected") {
    wsManager.sendTyping()
  }
}

// Subscribe to events
connectionService.on("typing_start", handleTypingStart)
connectionService.on("typing_stop", handleTypingStop)
connectionService.onLifecycle("typing_clear", clearTypingUsers)

export function useTyping() {
  return {
    typingUsers,
    sendTyping
  }
}
