import { createMemo } from "solid-js"
import type { Session, User } from "../../../shared/types"
import type { ServerInfo } from "../lib/api/types"
import { connectionService } from "../lib/connection"
import { addServerEntry } from "./servers"
import { addUsers, getUserById, updateUser, users } from "./users"

// Ensure store modules are imported so their event subscriptions run
import "./messages"
import "./typing"
import "./voice"
import "./screen-share"

// Register data resolvers
connectionService.setResolvers({
  getUserById,
  onUserAdd: addUsers,
  onUserUpdate: updateUser,
  addServerEntry: (entry) => addServerEntry(entry)
})

export function useConnection() {
  const status = () => connectionService.getPhase()
  const currentServer = () => connectionService.getServer()
  const session = (): Session | null => {
    const s = connectionService.getSession()
    return s ? { serverId: s.serverId, status: s.status, connectedAt: s.connectedAt } : null
  }
  const connectionDetail = () => connectionService.getConnectionDetail()
  const shouldShowBanner = createMemo(() => connectionDetail().status !== "healthy")

  return {
    status,
    currentServer,
    session,
    currentUser: () => {
      const userId = connectionService.getUserId()
      return userId ? users[userId] : null
    },
    needsAuth: () => status() === "needs_auth",
    isConnected: () => status() === "connected",
    isServerUnavailable: () => status() === "failed",
    connectionState: status,
    connectionDetail,
    countdownSeconds: () => connectionService.getCountdown(),
    shouldShowBanner,
    connectToServer: (serverId: string) => connectionService.connectToServer(serverId),
    onAuthSuccess: (
      user: User,
      serverUrl: string,
      serverInfo: ServerInfo | null,
      tokens: { accessToken: string; refreshToken: string; expiresAt: string }
    ) => connectionService.onAuthSuccess(user, serverUrl, serverInfo, tokens),
    triggerAddServer: () => connectionService.triggerAddServer(),
    logout: () => connectionService.logout(),
    disconnect: () => connectionService.disconnect(),
    getServerUrl: () => connectionService.getServerUrl(),
    updateCurrentUser: (updates: Partial<User>) => connectionService.updateCurrentUser(updates),
    retryNow: () => connectionService.retryNow()
  }
}
