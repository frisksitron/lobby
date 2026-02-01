import { createSignal } from "solid-js"
import type { TypingUser } from "../../../shared/types"
import { TYPING_TIMEOUT_MS } from "../lib/constants/ui"
import { wsManager } from "../lib/ws"

const [typingUsers, setTypingUsers] = createSignal<TypingUser[]>([])
const typingTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

let getCurrentUserId: () => string | null = () => null
let getSessionStatus: () => string | null = () => null

export function initTyping(
  currentUserIdGetter: () => string | null,
  sessionStatusGetter: () => string | null
): void {
  getCurrentUserId = currentUserIdGetter
  getSessionStatus = sessionStatusGetter
}

export function handleTypingStart(payload: {
  user_id: string
  username: string
  timestamp: string
}): void {
  const userId = getCurrentUserId()
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

export function handleTypingStop(payload: { user_id: string }): void {
  const timeout = typingTimeouts.get(payload.user_id)
  if (timeout) {
    clearTimeout(timeout)
    typingTimeouts.delete(payload.user_id)
  }
  setTypingUsers((prev) => prev.filter((u) => u.userId !== payload.user_id))
}

export function clearTypingUsers(): void {
  for (const timeout of typingTimeouts.values()) clearTimeout(timeout)
  typingTimeouts.clear()
  setTypingUsers([])
}

export function sendTyping(): void {
  if (getSessionStatus() === "connected") {
    wsManager.sendTyping()
  }
}

export { typingUsers }

export function useTyping() {
  return {
    typingUsers,
    sendTyping
  }
}
