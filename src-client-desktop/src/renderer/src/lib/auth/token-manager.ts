/**
 * Token Manager - Pure token management without store dependencies
 *
 * Responsibilities:
 * - Auto-refresh tokens when expired
 * - Deduplicate concurrent refresh requests
 * - Notify subscribers on token refresh (e.g., WebSocket)
 * - Per-server token storage (keyed by server ID derived from URL)
 */

import { refreshTokens as apiRefreshTokens } from "../api/auth"
import { clearTokens, getTokens, setTokens } from "../storage"

// Current server URL (set when connection is established)
let currentServerUrl: string | null = null

// In-flight refresh promise for deduplication
let refreshPromise: Promise<string> | null = null

// Token refresh subscribers
type TokenRefreshCallback = (newToken: string) => void
const refreshSubscribers = new Set<TokenRefreshCallback>()

function getServerId(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function currentServerId(): string | null {
  return currentServerUrl ? getServerId(currentServerUrl) : null
}

export function setServerUrl(url: string): void {
  currentServerUrl = url
}

export function getServerUrl(): string | null {
  return currentServerUrl
}

export async function clearSession(): Promise<void> {
  const serverId = currentServerId()
  refreshPromise = null
  if (serverId) {
    await clearTokens(serverId)
  }
  currentServerUrl = null
}

export async function hasStoredSession(serverUrl: string): Promise<boolean> {
  const serverId = getServerId(serverUrl)
  const tokens = await getTokens(serverId)
  return !!tokens?.refreshToken
}

/**
 * Get a valid access token, refreshing if needed
 */
export async function getValidToken(): Promise<string | null> {
  const serverId = currentServerId()
  if (!serverId) return null

  const tokens = await getTokens(serverId)
  if (!tokens) return null

  // Token still valid (with 60s buffer)
  if (Date.now() < new Date(tokens.expiresAt).getTime() - 60000) {
    return tokens.accessToken
  }

  // Token expired, try to refresh
  try {
    return await refreshToken()
  } catch {
    return null
  }
}

/**
 * Force refresh the token. Deduplicates concurrent calls.
 */
export async function refreshToken(): Promise<string> {
  if (refreshPromise) return refreshPromise

  refreshPromise = doRefresh()
  try {
    return await refreshPromise
  } finally {
    refreshPromise = null
  }
}

async function doRefresh(): Promise<string> {
  if (!currentServerUrl) throw new Error("No server URL configured")
  const serverId = currentServerId()
  if (!serverId) throw new Error("No server ID configured")

  const tokens = await getTokens(serverId)
  if (!tokens?.refreshToken) throw new Error("No refresh token available")

  try {
    const result = await apiRefreshTokens(currentServerUrl, tokens.refreshToken)
    await setTokens(serverId, result.accessToken, result.refreshToken, result.expiresAt)
    refreshSubscribers.forEach((cb) => {
      try {
        cb(result.accessToken)
      } catch {}
    })
    return result.accessToken
  } catch (error) {
    // Only clear tokens when server explicitly rejected them (401/403)
    // Network errors and 5xx should not destroy the session
    const status = (error as { status?: number }).status
    if (status === 401 || status === 403) {
      await clearTokens(serverId)
    }
    throw error
  }
}

/**
 * Subscribe to token refresh events (used by WebSocket to update its token)
 */
export function onTokenRefresh(callback: TokenRefreshCallback): () => void {
  refreshSubscribers.add(callback)
  return () => refreshSubscribers.delete(callback)
}
