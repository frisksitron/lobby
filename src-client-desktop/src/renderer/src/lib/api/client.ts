import { setStatus } from "../../stores/status"
import { getServerUrl, getValidToken, refreshToken } from "../auth/token-manager"
import { ERROR_CODES, getErrorMessage } from "../errors/user-messages"
import { type APIError, ApiError } from "./types"

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown
}

export function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "")
}

/**
 * Make an authenticated request with automatic token refresh on 401
 */
export async function apiRequest<T>(
  serverUrl: string,
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const response = await doFetch(serverUrl, endpoint, options)

  // If 401, try refreshing the token once and retry
  if (response.status === 401) {
    try {
      await refreshToken()
    } catch {
      throw new ApiError("Session expired, please login again", "SESSION_EXPIRED", 401)
    }
    const retry = await doFetch(serverUrl, endpoint, options)
    return handleResponse<T>(retry)
  }

  return handleResponse<T>(response)
}

/**
 * Make an authenticated request using the currently configured server URL
 */
export async function apiRequestCurrentServer<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const serverUrl = getServerUrl()
  if (!serverUrl) {
    throw new ApiError("No server configured", "NO_SERVER", 400)
  }
  return apiRequest<T>(serverUrl, endpoint, options)
}

/**
 * Make an unauthenticated request (for public endpoints like server info)
 */
export async function publicRequest<T>(serverUrl: string, endpoint: string): Promise<T> {
  const url = `${normalizeUrl(serverUrl)}${endpoint}`
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json" }
  })
  return handleResponse<T>(response)
}

async function doFetch(
  serverUrl: string,
  endpoint: string,
  options: RequestOptions
): Promise<Response> {
  const url = `${normalizeUrl(serverUrl)}${endpoint}`
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>)
  }

  const accessToken = await getValidToken()
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  return fetch(url, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  })
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    // Handle rate limiting (429)
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After")
      const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60

      setStatus({
        type: "message",
        code: ERROR_CODES.API_RATE_LIMITED,
        message: getErrorMessage(ERROR_CODES.API_RATE_LIMITED),
        expiresAt: Date.now() + retrySeconds * 1000
      })

      throw new ApiError("Too many requests", "RATE_LIMITED", 429)
    }

    let errorData: APIError | null = null
    try {
      errorData = await response.json()
    } catch {}

    const message = errorData?.error?.message || response.statusText || "Request failed"
    const code = errorData?.error?.code || "UNKNOWN_ERROR"
    throw new ApiError(message, code, response.status)
  }

  if (response.status === 204) return undefined as T
  return response.json()
}
