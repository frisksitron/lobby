import { createMemo, createResource, createRoot, createSignal } from "solid-js"
import type { Message, MessageAttachment } from "../../../shared/types"
import { apiRequest, apiRequestCurrentServer } from "../lib/api/client"
import { ApiError } from "../lib/api/types"
import { uploadChatAttachment } from "../lib/api/uploads"
import { connectionService } from "../lib/connection"
import { ERROR_CODES, getErrorMessage } from "../lib/errors/user-messages"
import { formatUploadTooLargeMessage, toValidMaxBytes } from "../lib/files"
import { createLogger } from "../lib/logger"
import type { ErrorPayload, MessageCreatePayload } from "../lib/ws"
import { wsManager } from "../lib/ws"
import { setStatus } from "./status"
import { users } from "./users"

const log = createLogger("Messages")

function getUploadMaxBytes(): number | null {
  return toValidMaxBytes(connectionService.getServer()?.info?.uploadMaxBytes)
}

function fileTooLargeMessage(maxBytes: number | null): string {
  return formatUploadTooLargeMessage(maxBytes, "File")
}

interface MessageAttachmentResponse {
  id: string
  name: string
  mimeType: string
  size: number
  url: string
  previewUrl?: string
  previewWidth?: number
  previewHeight?: number
}

interface MessageResponse {
  id: string
  authorId: string
  authorName: string
  authorAvatarUrl?: string
  content: string
  attachments?: MessageAttachmentResponse[]
  createdAt: string
}

type DraftAttachmentStatus = "uploading" | "ready" | "failed"

export interface DraftAttachment {
  localId: string
  status: DraftAttachmentStatus
  name: string
  size: number
  mimeType: string
  file?: File
  id?: string
  url?: string
  previewUrl?: string
  previewWidth?: number
  previewHeight?: number
  error?: string
}

function toMessageAttachment(attachment: {
  id: string
  name: string
  size: number
  url: string
  mimeType?: string
  mime_type?: string
  previewUrl?: string
  preview_url?: string
  previewWidth?: number
  preview_width?: number
  previewHeight?: number
  preview_height?: number
}): MessageAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType ?? attachment.mime_type ?? "application/octet-stream",
    size: attachment.size,
    url: attachment.url,
    previewUrl: attachment.previewUrl ?? attachment.preview_url,
    previewWidth: attachment.previewWidth ?? attachment.preview_width,
    previewHeight: attachment.previewHeight ?? attachment.preview_height
  }
}

function toMessage(msg: MessageResponse): Message {
  return {
    id: msg.id,
    serverId: "",
    authorId: msg.authorId,
    authorName: msg.authorName,
    authorAvatarUrl: msg.authorAvatarUrl,
    content: msg.content,
    attachments: (msg.attachments ?? []).map(toMessageAttachment),
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
      setDraftAttachments([])
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

// Draft attachments currently shown in composer
const [draftAttachments, setDraftAttachments] = createSignal<DraftAttachment[]>([])

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

function generateLocalAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function getDraftSendBlockReason(): string | null {
  const uploading = draftAttachments().filter(
    (attachment) => attachment.status === "uploading"
  ).length
  if (uploading > 0) {
    return uploading === 1 ? "Uploading 1 file..." : `Uploading ${uploading} files...`
  }

  const failed = draftAttachments().filter((attachment) => attachment.status === "failed").length
  if (failed > 0) {
    return failed === 1
      ? "1 attachment failed. Retry or remove it before sending."
      : `${failed} attachments failed. Retry or remove them before sending.`
  }

  return null
}

function canSendDraft(): boolean {
  return getDraftSendBlockReason() === null
}

async function uploadDraftAttachment(localId: string, file: File): Promise<void> {
  try {
    const uploaded = await uploadChatAttachment(file)
    setDraftAttachments((prev) =>
      prev.map((attachment) =>
        attachment.localId === localId
          ? {
              ...attachment,
              status: "ready",
              id: uploaded.id,
              name: uploaded.name,
              mimeType: uploaded.mimeType,
              size: uploaded.size,
              url: uploaded.url,
              previewUrl: uploaded.preview?.url,
              previewWidth: uploaded.preview?.width,
              previewHeight: uploaded.preview?.height,
              file: undefined,
              error: undefined
            }
          : attachment
      )
    )
  } catch (error) {
    const uploadMaxBytes = getUploadMaxBytes()
    const message =
      error instanceof ApiError
        ? error.code === "PAYLOAD_TOO_LARGE"
          ? fileTooLargeMessage(uploadMaxBytes)
          : error.message
        : error instanceof Error
          ? error.message
          : "Upload failed"

    setDraftAttachments((prev) =>
      prev.map((attachment) =>
        attachment.localId === localId
          ? {
              ...attachment,
              status: "failed",
              error: message
            }
          : attachment
      )
    )
  }
}

function addDraftFiles(files: FileList | File[]): void {
  const fileList = Array.from(files)
  if (fileList.length === 0) return
  const uploadMaxBytes = getUploadMaxBytes()

  for (const file of fileList) {
    const localId = generateLocalAttachmentId()

    if (uploadMaxBytes !== null && file.size > uploadMaxBytes) {
      setDraftAttachments((prev) => [
        ...prev,
        {
          localId,
          status: "failed",
          name: file.name,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
          error: fileTooLargeMessage(uploadMaxBytes)
        }
      ])
      continue
    }

    const attachment: DraftAttachment = {
      localId,
      status: "uploading",
      name: file.name,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      file
    }

    setDraftAttachments((prev) => [...prev, attachment])
    void uploadDraftAttachment(localId, file)
  }
}

function removeDraftAttachment(localId: string): void {
  setDraftAttachments((prev) => prev.filter((attachment) => attachment.localId !== localId))
}

function retryDraftAttachment(localId: string): void {
  const attachment = draftAttachments().find((entry) => entry.localId === localId)
  if (!attachment?.file) return

  setDraftAttachments((prev) =>
    prev.map((entry) =>
      entry.localId === localId
        ? {
            ...entry,
            status: "uploading",
            error: undefined
          }
        : entry
    )
  )
  void uploadDraftAttachment(localId, attachment.file)
}

function clearDraftAttachments(): void {
  setDraftAttachments([])
}

// Module-level event subscriptions
connectionService.on("server_error", (payload: ErrorPayload) => {
  if (payload.code === "RATE_LIMITED") {
    const expiresAt =
      payload.retry_after && payload.retry_after > Date.now()
        ? payload.retry_after
        : Date.now() + 2_000

    setStatus({
      type: "message",
      code: ERROR_CODES.MESSAGE_RATE_LIMITED,
      message: getErrorMessage(ERROR_CODES.MESSAGE_RATE_LIMITED),
      expiresAt
    })
  } else if (payload.code === "ATTACHMENT_INVALID") {
    setStatus({
      type: "message",
      code: ERROR_CODES.ATTACHMENT_INVALID,
      message: getErrorMessage(ERROR_CODES.ATTACHMENT_INVALID)
    })
  }

  const shouldRemovePending =
    (payload.code === "RATE_LIMITED" || payload.code === "ATTACHMENT_INVALID") && !!payload.nonce
  if (!shouldRemovePending || !payload.nonce) return

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
  const payloadAttachments = (payload.attachments ?? []).map(toMessageAttachment)

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
              content: payload.content,
              attachments: payloadAttachments,
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
    attachments: payloadAttachments,
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

function sendMessage(serverId: string, content: string): boolean {
  const userId = connectionService.getUserId()
  const currentUserValue = userId ? users[userId] : null
  if (!currentUserValue) return false

  const readyAttachments = draftAttachments().filter(
    (attachment) => attachment.status === "ready" && !!attachment.id
  )

  if (!canSendDraft()) {
    return false
  }

  if (content.trim() === "" && readyAttachments.length === 0) {
    return false
  }

  const nonce = generateNonce()
  const attachmentModels: MessageAttachment[] = readyAttachments
    .filter(
      (attachment): attachment is DraftAttachment & { id: string } =>
        typeof attachment.id === "string"
    )
    .map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      url: attachment.url || "",
      previewUrl: attachment.previewUrl,
      previewWidth: attachment.previewWidth,
      previewHeight: attachment.previewHeight
    }))
  const attachmentIDs = attachmentModels.map((attachment) => attachment.id)

  const tempMessage: Message = {
    id: `pending-${nonce}`,
    serverId,
    authorId: currentUserValue.id,
    authorName: currentUserValue.username,
    authorAvatarUrl: currentUserValue.avatarUrl,
    content,
    attachments: attachmentModels,
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

  wsManager.sendMessage(content, nonce, attachmentIDs)
  setDraftAttachments([])
  return true
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
  setDraftAttachments([])
  setHasMoreHistory(true)
}

export function useMessages() {
  return {
    messages: allMessages,
    initialMessages,
    isLoadingHistory,
    hasMoreHistory,
    draftAttachments,
    canSendDraft,
    getDraftSendBlockReason,
    getMessagesForServer,
    addDraftFiles,
    removeDraftAttachment,
    retryDraftAttachment,
    clearDraftAttachments,
    sendMessage,
    loadMoreHistory,
    clearMessages
  }
}
