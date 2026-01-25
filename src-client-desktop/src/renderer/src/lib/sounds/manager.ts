// UI Sound Manager - plays notification sounds for app events

import type { SoundType } from "../../../../shared/types"
import deafenUrl from "../../assets/sounds/deaf.mp3"
import userLeaveUrl from "../../assets/sounds/deconnected.mp3"
import userJoinUrl from "../../assets/sounds/incoming-user.mp3"
import muteUrl from "../../assets/sounds/muted.mp3"
import undeafenUrl from "../../assets/sounds/non-deaf.mp3"
import unmuteUrl from "../../assets/sounds/non-muted.mp3"
import { UI_SOUND_VOLUME } from "../constants/ui"

export type { SoundType }

const soundUrls: Record<SoundType, string> = {
  "user-join": userJoinUrl,
  "user-leave": userLeaveUrl,
  mute: muteUrl,
  unmute: unmuteUrl,
  deafen: deafenUrl,
  undeafen: undeafenUrl
}

export function playSound(type: SoundType): void {
  const url = soundUrls[type]
  if (!url) return

  const audio = new Audio(url)
  audio.volume = UI_SOUND_VOLUME
  audio.play().catch(() => {})
}
