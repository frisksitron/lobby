export interface User {
  // Profile data (from REST API)
  id: string
  username: string
  avatarUrl?: string
  email?: string
  createdAt?: string // ISO 8601

  // Session state (from WebSocket)
  status: "online" | "idle" | "dnd" | "offline"
  inVoice: boolean
  voiceMuted: boolean
  voiceDeafened: boolean
  voiceSpeaking: boolean
  isStreaming?: boolean
}

export interface Server {
  id: string
  name: string
  iconUrl?: string
  ownerId: string
  memberIds: string[]
}

export interface Message {
  id: string
  serverId: string
  authorId: string
  authorName: string
  authorAvatarUrl?: string
  content: string
  attachments?: MessageAttachment[]
  timestamp: string
}

export interface MessageAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  url: string
  previewUrl?: string
  previewWidth?: number
  previewHeight?: number
}

export interface VoiceParticipant {
  userId: string
  muted: boolean
  deafened: boolean
  speaking: boolean
}

export interface VoiceState {
  inVoice: boolean
  serverId: string | null
  participants: VoiceParticipant[]
  localMuted: boolean
  localDeafened: boolean
}

// Session types
export type SessionStatus = "disconnected" | "connecting" | "connected" | "error"

export interface Session {
  serverId: string
  status: SessionStatus
  error?: string
  connectedAt?: number
}

export interface LocalVoiceState {
  connecting: boolean
  inVoice: boolean
  muted: boolean
  deafened: boolean
}

// Typing indicator state
export interface TypingUser {
  userId: string
  username: string
  timestamp: string
}

// Storage types (used by preload/renderer)
export interface SecureTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string
}

export type NoiseSuppressionAlgorithm = "speex" | "rnnoise" | "none"

export type SettingsTab = "account" | "server" | "voice" | "appearance" | "about"

export interface AppSettings {
  inputDevice: string
  outputDevice: string
  lastActiveServerId: string | null
  lastSettingsTab: SettingsTab
  noiseSuppression: NoiseSuppressionAlgorithm
  themeId: string
  userVolumes: Record<string, number> // userId -> volume (0-200)
  echoCancellation: boolean
  compressor: boolean
  compactMode: boolean
}

export interface ServerEntry {
  id: string
  name: string
  url: string
  iconUrl?: string
  uploadMaxBytes?: number
  email?: string
}

// Theme types
export type SoundType = "user-join" | "user-leave" | "mute" | "unmute" | "deafen" | "undeafen"

export interface ThemeColors {
  background: string
  surface: string
  surfaceElevated: string
  border: string
  textPrimary: string
  textSecondary: string
  accent: string
  accentHover: string
  success: string
  warning: string
  error: string
  avatarColors: string[]
}

export type ThemeMode = "light" | "dark"

export interface Theme {
  id: string
  name: string
  mode: ThemeMode
  colors: ThemeColors
}
