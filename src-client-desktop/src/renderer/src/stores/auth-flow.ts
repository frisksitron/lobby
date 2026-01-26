/**
 * Auth Flow Store - UI-only auth flow state
 *
 * Handles:
 * - Auth flow steps (server-url, email-input, code-input, register)
 * - Form state and validation
 * - Loading and error states
 * - Returns AuthResult for caller to route through connection store
 *
 * Has ZERO store imports - purely handles auth UI flow and API calls.
 */

import { createSignal } from "solid-js"
import type { User } from "../../../shared/types"
import {
  getServerInfo as apiGetServerInfo,
  requestMagicCode as apiRequestMagicCode,
  updateMe as apiUpdateMe,
  verifyMagicCode as apiVerifyMagicCode
} from "../lib/api/auth"
import type { AuthResponse, ServerInfo } from "../lib/api/types"
import type { AuthFlowStep } from "../lib/auth/types"
import { createLogger } from "../lib/logger"
import { clearTokens, setTokens } from "../lib/storage"

const log = createLogger("AuthFlow")

export interface AuthResult {
  user: User
  serverUrl: string
  serverInfo: ServerInfo | null
  tokens: { accessToken: string; refreshToken: string; expiresAt: string }
}

// Auth flow step
const [step, setStep] = createSignal<AuthFlowStep>("server-url")

// Server info gathered during auth
const [serverUrl, setServerUrl] = createSignal("")
const [serverInfo, setServerInfo] = createSignal<ServerInfo | null>(null)

// Email auth state
const [pendingEmail, setPendingEmail] = createSignal("")

// Pending auth response for registration
const [pendingAuthResponse, setPendingAuthResponse] = createSignal<AuthResponse | null>(null)

// UI state
const [authError, setAuthError] = createSignal<string | null>(null)
const [isLoading, setIsLoading] = createSignal(false)

/**
 * Reset the auth flow to initial state
 */
function resetAuthFlow(): void {
  setStep("server-url")
  setServerUrl("")
  setServerInfo(null)
  setPendingEmail("")
  setPendingAuthResponse(null)
  setAuthError(null)
  setIsLoading(false)
}

/**
 * Start auth flow (fresh or re-auth).
 * If server info is provided, skip to email-input and pre-fill stored email.
 */
async function startAuthFlow(
  server?: { url: string; id: string; name: string } | null
): Promise<void> {
  if (server) {
    // Server is known - skip URL entry and go to email input
    setServerUrl(server.url)
    setAuthError(null)
    setIsLoading(true)

    // Always fetch fresh server info to confirm server is reachable
    try {
      const info = await apiGetServerInfo(server.url)
      setServerInfo(info)
    } catch {
      setServerInfo(null)
      setAuthError("Cannot reach server")
      setIsLoading(false)
      return
    }

    setStep("email-input")
    setIsLoading(false)

    // Pre-fill email from stored server entry
    const servers = await window.api.servers.getAll()
    const stored = servers.find((s) => s.id === server.id)
    if (stored?.email) {
      setPendingEmail(stored.email)
    }
  } else {
    // No server context - start from server URL
    resetAuthFlow()
  }
}

/**
 * Connect to a server (first step in auth flow - fetches server info)
 */
async function connectToServer(url: string): Promise<boolean> {
  setIsLoading(true)
  setAuthError(null)

  try {
    // Check if this server is already added
    const servers = await window.api.servers.getAll()
    const host = new URL(url).host
    const alreadyAdded = servers.some((s) => {
      try {
        return new URL(s.url).host === host
      } catch {
        return false
      }
    })
    if (alreadyAdded) {
      setAuthError("This server is already added")
      return false
    }

    const info = await apiGetServerInfo(url)
    if (info) {
      setServerUrl(url)
      setServerInfo(info)
      setStep("email-input")
      return true
    } else {
      setAuthError("Invalid server URL or server not reachable")
      return false
    }
  } catch (error) {
    log.error("Failed to connect to server:", error)
    setAuthError("Failed to connect to server")
    return false
  } finally {
    setIsLoading(false)
  }
}

/**
 * Start email auth - request magic code
 */
async function startEmailAuth(email: string): Promise<boolean> {
  setIsLoading(true)
  setAuthError(null)

  try {
    await apiRequestMagicCode(serverUrl(), email)
    setPendingEmail(email)
    setStep("code-input")
    return true
  } catch (error) {
    log.error("Failed to send magic code:", error)
    setAuthError("Failed to send login code")
    return false
  } finally {
    setIsLoading(false)
  }
}

/**
 * Verify magic code.
 * Returns AuthResult if existing user, null if new user (registration needed).
 */
async function verifyMagicCode(code: string): Promise<AuthResult | null> {
  setIsLoading(true)
  setAuthError(null)

  try {
    const result = await apiVerifyMagicCode(serverUrl(), pendingEmail(), code)
    setPendingEmail(result.user.email || "")

    if (result.isNewUser) {
      // New user - need to complete registration
      setPendingAuthResponse(result)
      setStep("register")
      return null
    } else {
      // Existing user - return auth result for caller to handle
      const authResult: AuthResult = {
        user: result.user,
        serverUrl: serverUrl(),
        serverInfo: serverInfo(),
        tokens: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: result.expiresAt
        }
      }
      resetAuthFlow()
      return authResult
    }
  } catch (error) {
    log.error("Failed to verify magic code:", error)
    setAuthError("Invalid or expired code")
    return null
  } finally {
    setIsLoading(false)
  }
}

/**
 * Complete registration with username.
 * Returns AuthResult on success, null on failure.
 */
async function completeRegistration(username: string): Promise<AuthResult | null> {
  setIsLoading(true)
  setAuthError(null)

  const authResponse = pendingAuthResponse()
  if (!authResponse) {
    setAuthError("Registration session expired")
    setIsLoading(false)
    return null
  }

  const serverId = new URL(serverUrl()).host

  try {
    // First save the tokens so we can make authenticated requests
    await setTokens(
      serverId,
      authResponse.accessToken,
      authResponse.refreshToken,
      authResponse.expiresAt
    )

    // Update user with the chosen username
    const updatedUser = await apiUpdateMe(serverUrl(), authResponse.accessToken, {
      username,
      displayName: username
    })

    const authResult: AuthResult = {
      user: updatedUser,
      serverUrl: serverUrl(),
      serverInfo: serverInfo(),
      tokens: {
        accessToken: authResponse.accessToken,
        refreshToken: authResponse.refreshToken,
        expiresAt: authResponse.expiresAt
      }
    }

    resetAuthFlow()
    return authResult
  } catch (error) {
    log.error("Failed to complete registration:", error)
    // Clear tokens for this server on failure
    await clearTokens(serverId)
    setAuthError("Failed to create account")
    return null
  } finally {
    setIsLoading(false)
  }
}

/**
 * Navigate back in the auth flow.
 * Pass hasServer=true if reconnecting to a known server (hides "Change server" option).
 */
function goBack(hasServer?: boolean): void {
  switch (step()) {
    case "email-input":
      if (!hasServer) {
        setStep("server-url")
        setServerInfo(null)
      }
      break
    case "code-input":
      setStep("email-input")
      break
    case "register":
      setStep("email-input")
      break
  }
  setAuthError(null)
}

export function useAuthFlow() {
  return {
    // State
    step,
    serverUrl,
    serverInfo,
    pendingEmail,
    authError,
    isLoading,

    // Actions
    resetAuthFlow,
    startAuthFlow,
    connectToServer,
    startEmailAuth,
    verifyMagicCode,
    completeRegistration,
    goBack,
    setStep: (s: AuthFlowStep) => {
      setAuthError(null)
      setStep(s)
    }
  }
}
