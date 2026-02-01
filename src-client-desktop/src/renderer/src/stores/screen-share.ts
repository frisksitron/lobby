import { createSignal } from "solid-js"
import type { User } from "../../../shared/types"
import { createLogger } from "../lib/logger"
import { screenShareManager } from "../lib/webrtc"
import type { ScreenShareUpdatePayload } from "../lib/ws"
import { updateUser, users } from "./users"

const log = createLogger("ScreenShare")

const [isPickerOpen, setIsPickerOpen] = createSignal(false)
const [isLocallySharing, setIsLocallySharing] = createSignal(false)
const [localStream, setLocalStream] = createSignal<MediaStream | null>(null)
const [viewingStreamerId, setViewingStreamerId] = createSignal<string | null>(null)
const [remoteStream, setRemoteStream] = createSignal<MediaStream | null>(null)

let getCurrentUserId: () => string | null = () => null

export function initScreenShare(currentUserIdGetter: () => string | null): void {
  getCurrentUserId = currentUserIdGetter
}

export function openScreenPicker(): void {
  setIsPickerOpen(true)
}

export function closeScreenPicker(): void {
  setIsPickerOpen(false)
}

export async function startScreenShare(sourceId: string): Promise<void> {
  try {
    await screenShareManager.startShare(sourceId)
    // Set local stream for self-viewing
    const stream = screenShareManager.getLocalStream()
    setLocalStream(stream)
    // isLocallySharing state is set when server sends SCREEN_SHARE_UPDATE
    setIsPickerOpen(false)
  } catch (err) {
    log.error("Failed to start screen share:", err)
    setIsPickerOpen(false)
    throw err
  }
}

export function stopScreenShare(): void {
  if (!isLocallySharing()) return
  screenShareManager.stopShare()
  setLocalStream(null)
  // isLocallySharing state is set when server sends SCREEN_SHARE_UPDATE
}

export function subscribeToStream(streamerId: string): void {
  log.info(`[DEBUG] subscribeToStream called with streamerId: ${streamerId}`)
  screenShareManager.subscribeToStream(streamerId)
  // Don't set viewingStreamerId here - wait for the stream to actually arrive
  log.info(`[DEBUG] subscribeToStream completed, waiting for remote stream`)
}

export function unsubscribeFromStream(): void {
  screenShareManager.unsubscribe()
  setViewingStreamerId(null)
  setRemoteStream(null)
}

export function handleScreenShareUpdate(payload: ScreenShareUpdatePayload): void {
  const userId = getCurrentUserId()
  updateUser(payload.user_id, { isStreaming: payload.streaming })

  // If this is us, update local state
  if (userId && payload.user_id === userId) {
    setIsLocallySharing(payload.streaming)
  }

  // If the streamer we're watching stopped, clear viewing state
  if (!payload.streaming && viewingStreamerId() === payload.user_id) {
    screenShareManager.onStreamerStopped(payload.user_id)
    setViewingStreamerId(null)
    setRemoteStream(null)
  }
}

// Set up remote stream callback
screenShareManager.onRemoteStream((stream, streamerId) => {
  log.info(`[DEBUG] onRemoteStream callback - stream: ${!!stream}, streamerId: ${streamerId}`)
  setRemoteStream(stream)
  log.info(`[DEBUG] setRemoteStream called, current value: ${!!remoteStream()}`)
  if (stream && streamerId) {
    // Stream arrived - now update the viewing state to switch the UI
    setViewingStreamerId(streamerId)
    log.info(`[DEBUG] setViewingStreamerId called with: ${streamerId}`)
  } else {
    setViewingStreamerId(null)
  }
})

export function getActiveStreamers(): User[] {
  const userId = getCurrentUserId()
  return Object.values(users).filter((u) => u.isStreaming && u.id !== userId)
}

export { isPickerOpen, isLocallySharing, localStream, viewingStreamerId, remoteStream }

export function useScreenShare() {
  return {
    isPickerOpen,
    isLocallySharing,
    localStream,
    viewingStreamerId,
    remoteStream,
    openScreenPicker,
    closeScreenPicker,
    startScreenShare,
    stopScreenShare,
    subscribeToStream,
    unsubscribeFromStream
  }
}
