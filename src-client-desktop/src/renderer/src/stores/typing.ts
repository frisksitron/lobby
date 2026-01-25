import { type Accessor, createSignal } from "solid-js"
import type { TypingUser, User } from "../../../shared/types"
import { TYPING_TIMEOUT_MS } from "../lib/constants/ui"
import { wsManager } from "../lib/ws"

// Typing users state
const [typingUsers, setTypingUsers] = createSignal<TypingUser[]>([])

// Track timeouts per user to avoid accumulating timers
const typingTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Handle typing start from WebSocket
 */
export function handleTypingStart(
  payload: { user_id: string; timestamp: string },
  currentUser: User | null
): void {
  // Don't show own typing
  if (currentUser && payload.user_id === currentUser.id) return

  // Clear existing timeout for this user
  const existing = typingTimeouts.get(payload.user_id)
  if (existing) clearTimeout(existing)

  // Add user if not already in list
  setTypingUsers((prev) => {
    if (prev.some((u) => u.userId === payload.user_id)) return prev
    return [...prev, { userId: payload.user_id, timestamp: payload.timestamp }]
  })

  // Set new timeout to remove typing indicator
  typingTimeouts.set(
    payload.user_id,
    setTimeout(() => {
      setTypingUsers((prev) => prev.filter((u) => u.userId !== payload.user_id))
      typingTimeouts.delete(payload.user_id)
    }, TYPING_TIMEOUT_MS)
  )
}

/**
 * Handle typing stop from WebSocket (when user sends a message)
 */
export function handleTypingStop(payload: { user_id: string }): void {
  const timeout = typingTimeouts.get(payload.user_id)
  if (timeout) {
    clearTimeout(timeout)
    typingTimeouts.delete(payload.user_id)
  }
  setTypingUsers((prev) => prev.filter((u) => u.userId !== payload.user_id))
}

/**
 * Clear all typing users (called on disconnect)
 */
export function clearTypingUsers(): void {
  for (const timeout of typingTimeouts.values()) clearTimeout(timeout)
  typingTimeouts.clear()
  setTypingUsers([])
}

/**
 * Set up typing-related WebSocket listeners
 */
export function setupTypingListeners(getCurrentUser: () => User | null): (() => void)[] {
  const unsubscribes: (() => void)[] = []

  unsubscribes.push(
    wsManager.on("typing_start", (payload) => {
      handleTypingStart(payload, getCurrentUser())
    })
  )

  unsubscribes.push(
    wsManager.on("typing_stop", (payload) => {
      handleTypingStop(payload)
    })
  )

  return unsubscribes
}

/**
 * Get the typing users accessor
 */
export function getTypingUsers(): Accessor<TypingUser[]> {
  return typingUsers
}

/**
 * Send typing indicator via WebSocket
 */
export function sendTyping(isConnected: boolean): void {
  if (isConnected) {
    wsManager.sendTyping()
  }
}
