import { createMemo, createResource, createRoot, createSignal } from "solid-js"
import type { Message } from "../../../shared/types"
import { apiRequest, apiRequestCurrentServer } from "../lib/api/client"
import { connectionService } from "../lib/connection"
import { createLogger } from "../lib/logger"
import type { ErrorPayload, MessageCreatePayload } from "../lib/ws"
import { wsManager } from "../lib/ws"
import { users } from "./users"

const log = createLogger("Messages")

interface MessageResponse {
  id: string
  authorId: string
  authorName: string
  authorAvatarUrl?: string
  content: string
  createdAt: string
}

function toMessage(msg: MessageResponse): Message {
  return {
    id: msg.id,
    serverId: "",
    authorId: msg.authorId,
    authorName: msg.authorName,
    authorAvatarUrl: msg.authorAvatarUrl,
    content: msg.content,
    timestamp: msg.createdAt
  }
}

// Resource for initial message fetch - integrates with Suspense
// Depends on connectionVersion to refetch on reconnection
const [initialMessages] = createRoot(() =>
  createResource(
    () => {
      const url = connectionService.getServerUrl()
      const version = connectionService.getConnectionVersion()
      return url ? { url, version } : null
    },
    async (source) => {
      setPaginatedHistory([])
      setRealtimeMessages([])
      for (const timeout of pendingTimeouts.values()) clearTimeout(timeout)
      pendingTimeouts.clear()
      pendingMessages.clear()

      if (!source) return []
      const data = await apiRequest<MessageResponse[] | null>(
        source.url,
        "/api/v1/messages?limit=50"
      )
      const messages = (data ?? []).map(toMessage)
      messages.reverse()

      if (!data || data.length < 50) {
        setHasMoreHistory(false)
      } else {
        setHasMoreHistory(true)
      }

      return messages
    }
  )
)

// Paginated history: older messages loaded via infinite scroll (prepended)
const [paginatedHistory, setPaginatedHistory] = createSignal<Message[]>([])

// Realtime messages: new messages from WebSocket (appended)
const [realtimeMessages, setRealtimeMessages] = createSignal<Message[]>([])

// Loading state for pagination only (initial load handled by createResource)
const [isLoadingHistory, setIsLoadingHistory] = createSignal(false)
const [hasMoreHistory, setHasMoreHistory] = createSignal(true)

// Derived signal combining all message sources
const allMessages = createRoot(() =>
  createMemo(() => {
    const initial = initialMessages() ?? []
    const paginated = paginatedHistory()
    const realtime = realtimeMessages()

    // Combine: paginated history (oldest) + initial + realtime (newest)
    const combined = [...paginated, ...initial, ...realtime]

    // Dedupe by id and sort by timestamp
    const seen = new Set<string>()
    const deduped: Message[] = []
    for (const msg of combined) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id)
        deduped.push(msg)
      }
    }

    return deduped.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  })
)

const pendingMessages = new Map<string, Message>()
const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
const PENDING_MESSAGE_TIMEOUT_MS = 5000

function generateNonce(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

// Module-level event subscriptions
connectionService.on("server_error", (payload: ErrorPayload) => {
  if (payload.code !== "RATE_LIMITED" || !payload.nonce) return

  const pending = pendingMessages.get(payload.nonce)
  if (pending) {
    const timeout = pendingTimeouts.get(payload.nonce)
    if (timeout) {
      clearTimeout(timeout)
      pendingTimeouts.delete(payload.nonce)
    }
    pendingMessages.delete(payload.nonce)
    setRealtimeMessages((prev) => prev.filter((msg) => msg.id !== pending.id))
  }
})

connectionService.on("message_create", (payload: MessageCreatePayload) => {
  if (payload.nonce && pendingMessages.has(payload.nonce)) {
    const timeout = pendingTimeouts.get(payload.nonce)
    if (timeout) {
      clearTimeout(timeout)
      pendingTimeouts.delete(payload.nonce)
    }

    const pendingMsg = pendingMessages.get(payload.nonce)
    if (!pendingMsg) return
    pendingMessages.delete(payload.nonce)

    setRealtimeMessages((prev) =>
      prev.map((msg) =>
        msg.id === pendingMsg.id
          ? {
              ...msg,
              id: payload.id,
              timestamp: payload.created_at
            }
          : msg
      )
    )
    return
  }

  const newMessage: Message = {
    id: payload.id,
    serverId: "",
    authorId: payload.author.id,
    authorName: payload.author.username ?? "Unknown",
    authorAvatarUrl: payload.author.avatar_url,
    content: payload.content,
    timestamp: payload.created_at
  }

  // Check if message already exists in any source
  const existing = allMessages().some((m) => m.id === payload.id)
  if (!existing) {
    setRealtimeMessages((prev) => [...prev, newMessage])
  }
})

function getMessagesForServer(_serverId: string): Message[] {
  return allMessages()
}

function sendMessage(serverId: string, content: string): void {
  const userId = connectionService.getUserId()
  const currentUserValue = userId ? users[userId] : null
  if (!currentUserValue || !content.trim()) return

  const nonce = generateNonce()
  const trimmedContent = content.trim()

  const tempMessage: Message = {
    id: `pending-${nonce}`,
    serverId,
    authorId: currentUserValue.id,
    authorName: currentUserValue.username,
    authorAvatarUrl: currentUserValue.avatarUrl,
    content: trimmedContent,
    timestamp: new Date().toISOString()
  }

  pendingMessages.set(nonce, tempMessage)
  setRealtimeMessages((prev) => [...prev, tempMessage])

  const timeout = setTimeout(() => {
    if (pendingMessages.has(nonce)) {
      log.warn(`Message not confirmed, removing: ${nonce}`)
      pendingMessages.delete(nonce)
      pendingTimeouts.delete(nonce)
      setRealtimeMessages((prev) => prev.filter((msg) => msg.id !== tempMessage.id))
    }
  }, PENDING_MESSAGE_TIMEOUT_MS)
  pendingTimeouts.set(nonce, timeout)

  wsManager.sendMessage(trimmedContent, nonce)
}

async function loadMoreHistory(beforeId: string, limit: number = 50): Promise<number> {
  const url = connectionService.getServerUrl()
  if (!url) return 0

  setIsLoadingHistory(true)
  try {
    const params = new URLSearchParams()
    params.set("limit", String(limit))
    params.set("before", beforeId)

    const data = await apiRequestCurrentServer<MessageResponse[] | null>(
      `/api/v1/messages?${params}`
    )

    const historyMessages: Message[] = (data ?? []).map(toMessage)
    historyMessages.reverse()

    setPaginatedHistory((prev) => {
      const existingIds = new Set(prev.map((m) => m.id))
      const newMessages = historyMessages.filter((m) => !existingIds.has(m.id))
      return [...newMessages, ...prev]
    })

    if (!data || data.length < limit) {
      setHasMoreHistory(false)
    }

    return data?.length ?? 0
  } catch (error) {
    log.error("Failed to load message history:", error)
    return 0
  } finally {
    setIsLoadingHistory(false)
  }
}

function clearMessages(): void {
  for (const timeout of pendingTimeouts.values()) clearTimeout(timeout)
  pendingTimeouts.clear()
  pendingMessages.clear()
  setPaginatedHistory([])
  setRealtimeMessages([])
  setHasMoreHistory(true)
}

export function useMessages() {
  return {
    messages: allMessages,
    initialMessages,
    isLoadingHistory,
    hasMoreHistory,
    getMessagesForServer,
    sendMessage,
    loadMoreHistory,
    clearMessages
  }
}
