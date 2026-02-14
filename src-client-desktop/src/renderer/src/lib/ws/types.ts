// WebSocket Operation Codes
export enum WSOpCode {
  // DISPATCH - Events and commands with type field
  Dispatch = 0,

  // Lifecycle ops (Server -> Client)
  Hello = 1,
  Ready = 2,
  InvalidSession = 3
}

// Exact client/server WS protocol version.
// Bump this only for breaking wire-contract changes.
export const WS_PROTOCOL_VERSION = 1

// Event types (Server -> Client via DISPATCH)
export enum WSEventType {
  PresenceUpdate = "PRESENCE_UPDATE",
  MessageCreate = "MESSAGE_CREATE",
  TypingStart = "TYPING_START",
  TypingStop = "TYPING_STOP",
  UserUpdate = "USER_UPDATE",
  ServerUpdate = "SERVER_UPDATE",
  VoiceStateUpdate = "VOICE_STATE_UPDATE",
  RtcReady = "RTC_READY",
  RtcOffer = "RTC_OFFER",
  RtcAnswer = "RTC_ANSWER",
  RtcIceCandidate = "RTC_ICE_CANDIDATE",
  VoiceSpeaking = "VOICE_SPEAKING",
  UserJoined = "USER_JOINED",
  UserLeft = "USER_LEFT",
  Error = "ERROR",
  ScreenShareUpdate = "SCREEN_SHARE_UPDATE"
}

// Command types (Client -> Server via DISPATCH)
export enum WSCommandType {
  Identify = "IDENTIFY",
  PresenceSet = "PRESENCE_SET",
  MessageSend = "MESSAGE_SEND",
  Typing = "TYPING",
  VoiceJoin = "VOICE_JOIN",
  VoiceLeave = "VOICE_LEAVE",
  RtcOffer = "RTC_OFFER",
  RtcAnswer = "RTC_ANSWER",
  RtcIceCandidate = "RTC_ICE_CANDIDATE",
  VoiceStateSet = "VOICE_STATE_SET",
  ScreenShareStart = "SCREEN_SHARE_START",
  ScreenShareStop = "SCREEN_SHARE_STOP",
  ScreenShareSubscribe = "SCREEN_SHARE_SUBSCRIBE",
  ScreenShareUnsubscribe = "SCREEN_SHARE_UNSUBSCRIBE"
}

// Base WebSocket message
export interface WSMessage<T = unknown> {
  op: WSOpCode
  t?: string // Event/command type (only for DISPATCH)
  d?: T
}

// Server -> Client payloads

export type HelloPayload = Record<string, never>

export interface MemberState {
  id: string
  username: string
  avatar_url?: string
  status: "online" | "idle" | "dnd" | "offline"
  in_voice: boolean
  muted: boolean
  deafened: boolean
  streaming: boolean
  created_at: string // ISO 8601
}

export interface ReadyPayload {
  protocol_version: number
  session_id: string
  user: {
    id: string
    username: string
    email: string
    avatar_url?: string
    created_at?: string
    updated_at?: string
  }
  members: MemberState[]
}

export interface InvalidSessionPayload {
  resumable: boolean
}

export interface MessageCreatePayload {
  id: string
  author: {
    id: string
    username?: string
    avatar_url?: string
  }
  content: string
  attachments?: MessageAttachment[]
  created_at: string // ISO 8601
  nonce?: string
}

export interface MessageAttachment {
  id: string
  name: string
  mime_type: string
  size: number
  url: string
  preview_url?: string
  preview_width?: number
  preview_height?: number
}

export interface PresenceUpdatePayload {
  user_id: string
  status: "online" | "idle" | "dnd" | "offline"
}

export interface TypingStartPayload {
  user_id: string
  username: string
  timestamp: string
}

export interface TypingStopPayload {
  user_id: string
}

export interface UserUpdatePayload {
  id: string
  username?: string
  avatar_url?: string
}

export interface ServerUpdatePayload {
  name?: string
  icon_url?: string
}

// Client -> Server payloads (via DISPATCH)

export interface IdentifyPayload {
  token: string
  presence?: {
    status: "online" | "idle" | "dnd"
  }
}

export interface MessageSendPayload {
  content: string
  attachment_ids?: string[]
  nonce?: string
}

export interface PresenceSetPayload {
  status: "online" | "idle" | "dnd" | "offline"
}

export interface VoiceStateUpdatePayload {
  user_id: string
  in_voice: boolean
  muted: boolean
  deafened: boolean
}

export interface VoiceJoinPayload {
  muted?: boolean
  deafened?: boolean
}

// RTC Payload types

export interface ICEServerInfo {
  urls: string[]
  username?: string
  credential?: string
}

export interface RtcReadyPayload {
  ice_servers: ICEServerInfo[]
}

export interface RtcOfferPayload {
  sdp: string
}

export interface RtcAnswerPayload {
  sdp: string
}

export interface RtcIceCandidatePayload {
  candidate: string
  sdp_mid?: string
  sdp_mline_index?: number
}

export interface VoiceStateSetPayload {
  muted?: boolean
  deafened?: boolean
  speaking?: boolean
}

export interface UserJoinedPayload {
  member: MemberState
}

export interface UserLeftPayload {
  user_id: string
}

export interface VoiceSpeakingPayload {
  user_id: string
  speaking: boolean
}

export interface ErrorPayload {
  code: string
  message: string
  nonce?: string
  retry_after?: number // Unix ms timestamp
}

export interface ScreenShareUpdatePayload {
  user_id: string
  streaming: boolean
}

// WebSocket connection states
export type WSConnectionState = "disconnected" | "connecting" | "connected"

// Event types for the event emitter (internal client events)
export type WSClientEventType =
  | "connected"
  | "disconnected"
  | "ready"
  | "message_create"
  | "presence_update"
  | "typing_start"
  | "typing_stop"
  | "user_update"
  | "server_update"
  | "voice_state_update"
  | "rtc_ready"
  | "rtc_offer"
  | "rtc_answer"
  | "rtc_ice_candidate"
  | "voice_speaking"
  | "user_joined"
  | "user_left"
  | "invalid_session"
  | "error"
  | "server_error"
  | "screen_share_update"
  | "network_status_change"

export interface WSClientEvents {
  connected: undefined
  disconnected: undefined
  ready: ReadyPayload
  message_create: MessageCreatePayload
  presence_update: PresenceUpdatePayload
  typing_start: TypingStartPayload
  typing_stop: TypingStopPayload
  user_update: UserUpdatePayload
  server_update: ServerUpdatePayload
  voice_state_update: VoiceStateUpdatePayload
  rtc_ready: RtcReadyPayload
  rtc_offer: RtcOfferPayload
  rtc_answer: RtcAnswerPayload
  rtc_ice_candidate: RtcIceCandidatePayload
  voice_speaking: VoiceSpeakingPayload
  user_joined: UserJoinedPayload
  user_left: UserLeftPayload
  invalid_session: InvalidSessionPayload
  error: Error
  server_error: ErrorPayload
  screen_share_update: ScreenShareUpdatePayload
  network_status_change: { online: boolean }
}
