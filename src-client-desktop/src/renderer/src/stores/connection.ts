import { createMemo, onCleanup } from "solid-js"
import type { Session, User } from "../../../shared/types"
import type { ServerInfo } from "../lib/api/types"
import { type ConnectionDetail, type ConnectionPhase, connectionService } from "../lib/connection"
import { ERROR_CODES, getErrorMessage } from "../lib/errors/user-messages"
import { handleScreenShareUpdate, initScreenShare, stopScreenShare } from "./screen-share"
import { addServerEntry, initServers, loadServers, servers } from "./servers"
import { setStatus } from "./status"
import { clearTypingUsers, handleTypingStart, handleTypingStop, initTyping } from "./typing"
import { addUsers, clearUsers, getUserById, initUsers, updateUser, users } from "./users"
import {
  handleRtcReady,
  handleVoiceJoinCooldown,
  handleVoiceSpeaking,
  handleVoiceStateCooldown,
  handleVoiceStateUpdate,
  initVoice,
  resetVoiceReconnectState,
  restoreVoiceAfterReconnect,
  saveVoiceStateForReconnect,
  stopVoice
} from "./voice"

export type ConnectionStatus = ConnectionPhase

// Initialize dependent modules with getters
initTyping(
  () => connectionService.getUserId(),
  () => connectionService.getSession()?.status ?? null
)
initVoice(
  () => connectionService.getUserId(),
  () => connectionService.getSession()?.status ?? null,
  () => stopScreenShare()
)
initScreenShare(() => connectionService.getUserId())
initUsers(() => connectionService.getUserId())

// Initialize ConnectionService callbacks
connectionService.initCallbacks({
  onVoiceStateUpdate: (payload) =>
    handleVoiceStateUpdate(
      payload as { user_id: string; in_voice: boolean; muted: boolean; deafened: boolean }
    ),
  onRtcReady: handleRtcReady,
  onVoiceSpeaking: handleVoiceSpeaking,
  onTypingStart: (payload) =>
    handleTypingStart(payload as { user_id: string; username: string; timestamp: string }),
  onTypingStop: (payload) => handleTypingStop(payload as { user_id: string }),
  onScreenShareUpdate: (payload) =>
    handleScreenShareUpdate(payload as { user_id: string; streaming: boolean }),
  onServerError: (payload) => {
    if (payload.code === "VOICE_STATE_COOLDOWN") {
      handleVoiceStateCooldown()
      const expiresAt = payload.retry_after ?? Date.now() + 10_000 // 10s fallback
      setStatus({
        type: "voice",
        code: ERROR_CODES.VOICE_COOLDOWN,
        message: getErrorMessage(ERROR_CODES.VOICE_COOLDOWN),
        expiresAt
      })
    } else if (payload.code === "VOICE_JOIN_COOLDOWN") {
      handleVoiceJoinCooldown()
      const expiresAt = payload.retry_after ?? Date.now() + 15_000 // 15s fallback
      setStatus({
        type: "voice",
        code: ERROR_CODES.VOICE_JOIN_COOLDOWN,
        message: getErrorMessage(ERROR_CODES.VOICE_JOIN_COOLDOWN),
        expiresAt
      })
    }
  },
  onUserAdd: addUsers,
  onUserUpdate: updateUser,
  getUserById: getUserById,
  onUsersClear: clearUsers,
  onTypingClear: clearTypingUsers,
  saveVoiceState: saveVoiceStateForReconnect,
  restoreVoiceState: restoreVoiceAfterReconnect,
  resetVoiceReconnect: resetVoiceReconnectState,
  stopVoice: stopVoice,
  loadServers: loadServers,
  addServerEntry: (entry) => addServerEntry(entry),
  getServers: () =>
    servers().map((s) => ({
      id: s.id,
      name: s.name,
      url: "" // URL is not stored in Server type, retrieved from electron-store
    }))
})

// Initialize servers module
initServers(
  (id) => connectionService.connectToServer(id),
  () => connectionService.disconnect(),
  () => connectionService.getServer()?.id ?? null
)

// Public exports - maintain same API
export const status = () => connectionService.getPhase()
export const currentServer = () => connectionService.getServer()
export const currentUserId = () => connectionService.getUserId()
export const session = (): Session | null => {
  const s = connectionService.getSession()
  return s ? { serverId: s.serverId, status: s.status, connectedAt: s.connectedAt } : null
}
export const connectionVersion = () => connectionService.getConnectionVersion()

export const initialize = () => connectionService.initialize()
export const connectToServer = (serverId: string) => connectionService.connectToServer(serverId)
export const onAuthSuccess = (
  user: User,
  serverUrl: string,
  serverInfo: ServerInfo | null,
  tokens: { accessToken: string; refreshToken: string; expiresAt: string }
) => connectionService.onAuthSuccess(user, serverUrl, serverInfo, tokens)
export const triggerAddServer = () => connectionService.triggerAddServer()
export const triggerReauth = () => connectionService.triggerReauth()
export const logout = () => connectionService.logout()
export const disconnect = () => connectionService.disconnect()
export const getServerUrl = () => connectionService.getServerUrl()
export const retryNow = () => connectionService.retryNow()
export const setPresence = (presenceStatus: "online" | "idle" | "dnd" | "offline") =>
  connectionService.setPresence(presenceStatus)
export const updateCurrentUser = (updates: Partial<User>) =>
  connectionService.updateCurrentUser(updates)

export function getCurrentUser(): User | null {
  const userId = connectionService.getUserId()
  return userId ? users[userId] : null
}

export function shouldShowConnectionOverlay(
  connectionState: ConnectionStatus,
  detail: ConnectionDetail
): boolean {
  // Never show overlay when connected
  if (connectionState === "connected") return false
  return (
    connectionState === "connecting" ||
    connectionState === "failed" ||
    detail.status === "reconnecting" ||
    detail.status === "offline"
  )
}

export function useConnection() {
  const connectionDetail = () => connectionService.getConnectionDetail()

  const shouldShowBanner = createMemo(() => connectionDetail().status !== "healthy")

  onCleanup(() => {
    // Cleanup if needed
  })

  return {
    status,
    currentServer,
    session,
    currentUser: () => {
      const userId = connectionService.getUserId()
      return userId ? users[userId] : null
    },
    isInitializing: () => status() === "initializing",
    needsAuth: () => status() === "needs_auth",
    isConnected: () => status() === "connected",
    isServerUnavailable: () => status() === "failed",
    connectionState: status,
    connectionDetail,
    countdownSeconds: () => connectionService.getCountdown(),
    shouldShowBanner,
    initialize,
    connectToServer,
    onAuthSuccess,
    triggerAddServer,
    triggerReauth,
    logout,
    disconnect,
    getServerUrl,
    updateCurrentUser,
    retryNow
  }
}
