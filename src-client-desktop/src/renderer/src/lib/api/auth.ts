import type { User } from "../../../../shared/types"
import { apiRequest, normalizeUrl, publicRequest } from "./client"
import type {
  APIError,
  AuthResponse,
  RefreshResponse,
  ServerInfo,
  UpdateUserRequest,
  VerifyMagicCodeResponse
} from "./types"
import { ApiError } from "./types"

// Get server info (public endpoint)
export async function getServerInfo(serverUrl: string): Promise<ServerInfo> {
  return publicRequest<ServerInfo>(serverUrl, "/api/v1/server/info")
}

// Request a magic code to be sent to email
export async function requestMagicCode(serverUrl: string, email: string): Promise<void> {
  await apiRequest<void>(serverUrl, "/api/v1/auth/login/magic-code", {
    method: "POST",
    body: { email }
  })
}

// Verify magic code and get auth tokens
export async function verifyMagicCode(
  serverUrl: string,
  email: string,
  code: string
): Promise<VerifyMagicCodeResponse> {
  return apiRequest<VerifyMagicCodeResponse>(serverUrl, "/api/v1/auth/login/magic-code/verify", {
    method: "POST",
    body: { email, code }
  })
}

export async function registerAccount(
  serverUrl: string,
  registrationToken: string,
  username: string
): Promise<AuthResponse> {
  return apiRequest<AuthResponse>(serverUrl, "/api/v1/auth/register", {
    method: "POST",
    body: {
      registrationToken,
      username
    }
  })
}

// Refresh access token using refresh token
// Note: Uses raw fetch because this is called during token refresh flow
// and cannot use apiRequest which depends on getValidToken
export async function refreshTokens(
  serverUrl: string,
  refreshToken: string
): Promise<RefreshResponse> {
  const url = `${normalizeUrl(serverUrl)}/api/v1/auth/refresh`

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refreshToken })
  })

  if (!response.ok) {
    let errorData: APIError | null = null
    try {
      errorData = await response.json()
    } catch {}

    const code = errorData?.error?.code ?? "UNKNOWN_ERROR"
    const message = errorData?.error?.message ?? "Token refresh failed"
    throw new ApiError(message, code, response.status)
  }

  return response.json()
}

// Logout (invalidate tokens on server)
// Note: Uses raw fetch because we pass token explicitly and ignore errors
export async function logout(serverUrl: string, accessToken: string): Promise<void> {
  const url = `${normalizeUrl(serverUrl)}/api/v1/auth/logout`

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    }
  })
  // Ignore errors - we're logging out anyway
}

// Get current user info
export async function getMe(serverUrl: string): Promise<User> {
  return apiRequest<User>(serverUrl, "/api/v1/users/me")
}

// Update current user info
export async function updateMe(serverUrl: string, data: UpdateUserRequest): Promise<User> {
  return apiRequest<User>(serverUrl, "/api/v1/users/me", {
    method: "PATCH",
    body: data
  })
}

// Leave server (deactivate account)
export async function leaveServer(serverUrl: string): Promise<void> {
  await apiRequest<{ message: string }>(serverUrl, "/api/v1/users/me", {
    method: "DELETE"
  })
}
