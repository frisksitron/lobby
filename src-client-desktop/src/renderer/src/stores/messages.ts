import { createSignal } from "solid-js"
import type { Message } from "../../../shared/types"
import { apiRequestCurrentServer } from "../lib/api/client"
import { createLogger } from "../lib/logger"
import { type ErrorPayload, type MessageCreatePayload, wsManager } from "../lib/ws"
import { currentUser, getServerUrl } from "./connection"
import { showToast } from "./ui"

const log = createLogger("Messages")

const [messages, setMessages] = createSignal<Message[]>([])
const [isLoadingHistory, setIsLoadingHistory] = createSignal(false)
const [hasMoreHistory, setHasMoreHistory] = createSignal(true)
const [isInitialLoadComplete, setIsInitialLoadComplete] = createSignal(false)

const pendingMessages = new Map<string, Message>()
const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
const PENDING_MESSAGE_TIMEOUT_MS = 5000

function generateNonce(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export function useMessages() {
  const user = currentUser

  const setupMessageListener = (): (() => void)[] => {
    const unsubError = wsManager.on("server_error", (payload: ErrorPayload) => {
      if (payload.code !== "RATE_LIMITED" || !payload.nonce) return

      const pending = pendingMessages.get(payload.nonce)
      if (pending) {
        const timeout = pendingTimeouts.get(payload.nonce)
        if (timeout) {
          clearTimeout(timeout)
          pendingTimeouts.delete(payload.nonce)
        }
        pendingMessages.delete(payload.nonce)
        setMessages((prev) => prev.filter((msg) => msg.id !== pending.id))
        showToast("Sending too fast", "error")
      }
    })

    const unsubMessage = wsManager.on("message_create", (payload: MessageCreatePayload) => {
      if (payload.nonce && pendingMessages.has(payload.nonce)) {
        const timeout = pendingTimeouts.get(payload.nonce)
        if (timeout) {
          clearTimeout(timeout)
          pendingTimeouts.delete(payload.nonce)
        }

        const pendingMsg = pendingMessages.get(payload.nonce)
        if (!pendingMsg) return
        pendingMessages.delete(payload.nonce)

        setMessages((prev) =>
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
        content: payload.content,
        timestamp: payload.created_at
      }

      setMessages((prev) => {
        if (prev.some((m) => m.id === payload.id)) {
          return prev
        }
        return [...prev, newMessage]
      })
    })

    return [unsubError, unsubMessage]
  }

  const getMessagesForServer = (_serverId: string) => {
    return messages().sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
  }

  const sendMessage = (serverId: string, content: string) => {
    const currentUserValue = user()
    if (!currentUserValue || !content.trim()) return

    const nonce = generateNonce()
    const trimmedContent = content.trim()

    const tempMessage: Message = {
      id: `pending-${nonce}`,
      serverId,
      authorId: currentUserValue.id,
      content: trimmedContent,
      timestamp: new Date().toISOString()
    }

    pendingMessages.set(nonce, tempMessage)
    setMessages((prev) => [...prev, tempMessage])

    const timeout = setTimeout(() => {
      if (pendingMessages.has(nonce)) {
        log.warn(`Message not confirmed, removing: ${nonce}`)
        pendingMessages.delete(nonce)
        pendingTimeouts.delete(nonce)
        setMessages((prev) => prev.filter((msg) => msg.id !== tempMessage.id))
      }
    }, PENDING_MESSAGE_TIMEOUT_MS)
    pendingTimeouts.set(nonce, timeout)

    wsManager.sendMessage(trimmedContent, nonce)
  }

  const loadHistory = async (beforeId?: string, limit: number = 50): Promise<number> => {
    const url = getServerUrl()
    if (!url) return 0

    setIsLoadingHistory(true)
    try {
      const params = new URLSearchParams()
      params.set("limit", String(limit))
      if (beforeId) {
        params.set("before", beforeId)
      }

      const data = await apiRequestCurrentServer<Array<{
        id: string
        authorId: string
        content: string
        createdAt: string
      }> | null>(`/api/v1/messages?${params}`)

      const historyMessages: Message[] = (data ?? []).map((msg) => ({
        id: msg.id,
        serverId: "",
        authorId: msg.authorId,
        content: msg.content,
        timestamp: msg.createdAt
      }))

      historyMessages.reverse()

      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id))
        const newMessages = historyMessages.filter((m) => !existingIds.has(m.id))
        return [...newMessages, ...prev]
      })

      if (!data || data.length < limit) {
        setHasMoreHistory(false)
      }
      setIsInitialLoadComplete(true)

      return data?.length ?? 0
    } catch (error) {
      log.error("Failed to load message history:", error)
      setIsInitialLoadComplete(true)
      return 0
    } finally {
      setIsLoadingHistory(false)
    }
  }

  const resetHistoryState = (): void => {
    setHasMoreHistory(true)
    setIsInitialLoadComplete(false)
  }

  const clearMessages = (): void => {
    for (const timeout of pendingTimeouts.values()) clearTimeout(timeout)
    pendingTimeouts.clear()
    pendingMessages.clear()
    setMessages([])
    resetHistoryState()
  }

  return {
    messages,
    isLoadingHistory,
    hasMoreHistory,
    isInitialLoadComplete,
    getMessagesForServer,
    sendMessage,
    loadHistory,
    clearMessages,
    resetHistoryState,
    setupMessageListener
  }
}
