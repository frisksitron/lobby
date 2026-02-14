import type { User } from "../../../../shared/types"

// Auth response from login/verify endpoints
export interface AuthResponse {
  user: User
  accessToken: string
  refreshToken: string
  expiresAt: string
}

export type VerifyMagicCodeResponse = VerifyMagicCodeRegister | VerifyMagicCodeSession

export interface VerifyMagicCodeRegister {
  next: "register"
  registrationToken: string
  registrationExpiresAt: string
}

export interface VerifyMagicCodeSession {
  next: "session"
  session: AuthResponse
}

// Token refresh response
export interface RefreshResponse {
  accessToken: string
  refreshToken: string
  expiresAt: string
}

// Server info from /server/info
export interface ServerInfo {
  name: string
  iconUrl?: string
  uploadMaxBytes?: number
}

export interface ChatUploadResponse {
  id: string
  name: string
  mimeType: string
  size: number
  url: string
  preview?: {
    url: string
    width: number
    height: number
  }
}

// API error response
export interface APIError {
  error: {
    code: string
    message: string
  }
}

// Request magic code payload
export interface MagicCodeRequest {
  email: string
}

// Verify magic code payload
export interface VerifyMagicCodeRequest {
  email: string
  code: string
}

// Update user payload
export interface UpdateUserRequest {
  username?: string
}

// Custom error class for API errors
export class ApiError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.code = code
    this.status = status
  }
}
