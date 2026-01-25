import type { User } from "../../../../shared/types"

// Auth response from login/verify endpoints
export interface AuthResponse {
  user: User
  accessToken: string
  refreshToken: string
  expiresAt: string
  isNewUser: boolean
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
  auth: {
    methods: string[]
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
  displayName?: string
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
