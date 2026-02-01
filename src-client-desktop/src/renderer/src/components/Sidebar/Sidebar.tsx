import {
  TbOutlineActivity,
  TbOutlineHeadphones,
  TbOutlineHeadphonesOff,
  TbOutlineHeadset,
  TbOutlineMicrophone,
  TbOutlineMicrophoneOff,
  TbOutlinePhoneX,
  TbOutlineScreenShare,
  TbOutlineScreenShareOff
} from "solid-icons/tb"
import {
  type Component,
  createMemo,
  createSignal,
  For,
  Match,
  onMount,
  Show,
  Switch
} from "solid-js"
import type { User } from "../../../../shared/types"
import { createDeferred } from "../../lib/reactive"
import { audioManager } from "../../lib/webrtc"
import { useConnection } from "../../stores/connection"
import { useScreenShare } from "../../stores/screen-share"
import { useSettings } from "../../stores/settings"
import { useUsers } from "../../stores/users"
import { useVoice } from "../../stores/voice"
import Button from "../shared/Button"
import ButtonWithIcon from "../shared/ButtonWithIcon"
import UserIdentity from "../shared/UserIdentity"
import UserCard from "./UserCard"
import VoiceStatsPanel from "./VoiceStatsPanel"

interface MemberItemProps {
  user: User
  inVoice?: boolean
  isCurrentUser: boolean
  isSelected: boolean
  onClick: (rect: DOMRect) => void
}

const MemberItem: Component<MemberItemProps> = (props) => {
  let itemRef: HTMLDivElement | undefined

  const handleClick = () => {
    if (itemRef) {
      props.onClick(itemRef.getBoundingClientRect())
    }
  }

  return (
    <div
      ref={itemRef}
      class="flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors cursor-pointer hover:bg-surface-elevated"
      classList={{ "bg-surface-elevated": props.isSelected }}
      onClick={handleClick}
    >
      <UserIdentity
        name={props.user.username}
        avatarUrl={props.user.avatarUrl}
        status={props.user.status}
        size="sm"
      />
      <Show when={props.inVoice}>
        <TbOutlineHeadphones class="w-4 h-4 text-success" />
      </Show>
    </div>
  )
}

interface VoiceMemberItemProps {
  user: User
  isCurrentUser: boolean
  isSelected: boolean
  onClick: (rect: DOMRect) => void
}

const VoiceMemberItem: Component<VoiceMemberItemProps> = (props) => {
  let itemRef: HTMLDivElement | undefined

  const handleClick = () => {
    if (itemRef) {
      props.onClick(itemRef.getBoundingClientRect())
    }
  }

  return (
    <div
      ref={itemRef}
      class="flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors cursor-pointer hover:bg-surface-elevated/50"
      classList={{ "bg-surface-elevated/50": props.isSelected }}
      onClick={handleClick}
    >
      <UserIdentity
        name={props.user.username}
        avatarUrl={props.user.avatarUrl}
        status={props.user.status}
        size="sm"
        speaking={props.user.voiceSpeaking}
      />
      <div class="ml-auto flex items-center gap-1.5">
        <Show when={props.user.isStreaming}>
          <TbOutlineScreenShare class="w-[18px] h-[18px] shrink-0 text-accent" />
        </Show>
        <Switch>
          <Match when={props.user.voiceDeafened}>
            <TbOutlineHeadphonesOff class="w-4 h-4 shrink-0 text-error" />
          </Match>
          <Match when={props.user.voiceMuted}>
            <TbOutlineMicrophoneOff class="w-4 h-4 shrink-0 text-error" />
          </Match>
        </Switch>
      </div>
    </div>
  )
}

const VoiceControlsRow: Component = () => {
  const { localVoice, toggleMute, toggleDeafen } = useVoice()
  const { isLocallySharing, openScreenPicker, stopScreenShare } = useScreenShare()
  const [statsOpen, setStatsOpen] = createSignal(false)
  const [statsAnchorRect, setStatsAnchorRect] = createSignal<DOMRect | null>(null)
  let statsButtonRef: HTMLButtonElement | undefined

  const handleStatsClick = () => {
    if (statsButtonRef) {
      setStatsAnchorRect(statsButtonRef.getBoundingClientRect())
    }
    setStatsOpen(!statsOpen())
  }

  const handleStatsClose = () => {
    setStatsOpen(false)
  }

  const handleScreenShare = () => {
    if (isLocallySharing()) {
      stopScreenShare()
    } else {
      openScreenPicker()
    }
  }

  return (
    <>
      <div class="flex items-center justify-center gap-1.5 mb-3">
        <ButtonWithIcon
          icon={
            localVoice().muted ? (
              <TbOutlineMicrophoneOff class="w-5 h-5" />
            ) : (
              <TbOutlineMicrophone class="w-5 h-5" />
            )
          }
          variant={localVoice().muted ? "danger" : "secondary"}
          round
          onClick={toggleMute}
          title={localVoice().muted ? "Unmute" : "Mute"}
        />

        <ButtonWithIcon
          icon={
            localVoice().deafened ? (
              <TbOutlineHeadphonesOff class="w-5 h-5" />
            ) : (
              <TbOutlineHeadphones class="w-5 h-5" />
            )
          }
          variant={localVoice().deafened ? "danger" : "secondary"}
          round
          onClick={toggleDeafen}
          title={localVoice().deafened ? "Undeafen" : "Deafen"}
        />

        <ButtonWithIcon
          icon={
            isLocallySharing() ? (
              <TbOutlineScreenShareOff class="w-5 h-5" />
            ) : (
              <TbOutlineScreenShare class="w-5 h-5" />
            )
          }
          variant={isLocallySharing() ? "danger" : "secondary"}
          round
          onClick={handleScreenShare}
          title={isLocallySharing() ? "Stop Sharing" : "Share Screen"}
        />

        <button
          ref={statsButtonRef}
          type="button"
          class="p-2 rounded-full transition-colors hover:bg-surface-elevated cursor-pointer"
          classList={{ "bg-surface-elevated": statsOpen() }}
          onClick={handleStatsClick}
          title="Voice Stats"
        >
          <TbOutlineActivity class="w-5 h-5 text-text-secondary" />
        </button>
      </div>

      <VoiceStatsPanel
        isOpen={statsOpen()}
        onClose={handleStatsClose}
        anchorRect={statsAnchorRect()}
      />
    </>
  )
}

const Sidebar: Component = () => {
  const { localVoice, joinVoice, leaveVoice } = useVoice()
  const { isServerUnavailable, currentUser, session } = useConnection()
  const { getAllUsers } = useUsers()
  const { settings } = useSettings()
  const { subscribeToStream } = useScreenShare()

  const showConnecting = createDeferred(() => localVoice().connecting, 200)

  const [selectedUser, setSelectedUser] = createSignal<{
    user: User
    rect: DOMRect
  } | null>(null)

  // Load user volumes into audio manager on mount
  onMount(() => {
    const volumes = settings().userVolumes
    if (volumes) {
      audioManager.loadUserVolumes(volumes)
    }
  })

  // Get current user ID to prevent self-card
  const currentUserId = () => currentUser()?.id

  const groupedUsers = createMemo(() => {
    const all = getAllUsers()

    const voiceOnline = all.filter((u) => u.inVoice && u.status !== "offline")
    const online = all.filter((u) => !u.inVoice && u.status !== "offline")
    const offline = all.filter((u) => u.status === "offline")

    return { voiceOnline, online, offline }
  })

  const handleJoinVoice = (): void => {
    const currentSession = session()
    if (currentSession?.status === "connected" && !isServerUnavailable()) {
      joinVoice()
    }
  }

  const canJoinVoice = (): boolean => {
    const currentSession = session()
    return currentSession?.status === "connected" && !isServerUnavailable()
  }

  const handleMemberClick = (user: User, rect: DOMRect): void => {
    setSelectedUser({ user, rect })
  }

  const handleCloseUserCard = (): void => {
    setSelectedUser(null)
  }

  const handleWatchStream = (streamerId: string): void => {
    subscribeToStream(streamerId)
  }

  return (
    <div class="w-60 bg-surface rounded-xl flex flex-col m-2 overflow-hidden ring-1 ring-white/8">
      <div class="flex-1 overflow-y-auto px-2 py-3">
        <div class="space-y-1">
          <h4 class="text-xs font-medium text-text-muted px-2 pb-1">
            Online — {groupedUsers().voiceOnline.length + groupedUsers().online.length}
          </h4>

          <Show when={groupedUsers().voiceOnline.length > 0}>
            <div class="ring-1 ring-accent/25 rounded-lg bg-accent/10 mb-1 space-y-1">
              <For each={groupedUsers().voiceOnline}>
                {(user) => (
                  <VoiceMemberItem
                    user={user}
                    isCurrentUser={user.id === currentUserId()}
                    isSelected={selectedUser()?.user.id === user.id}
                    onClick={(rect) => handleMemberClick(user, rect)}
                  />
                )}
              </For>
            </div>
          </Show>

          <For each={groupedUsers().online}>
            {(user) => (
              <MemberItem
                user={user}
                isCurrentUser={user.id === currentUserId()}
                isSelected={selectedUser()?.user.id === user.id}
                onClick={(rect) => handleMemberClick(user, rect)}
              />
            )}
          </For>
        </div>

        <div class="space-y-1 mt-4">
          <h4 class="text-xs font-medium text-text-muted px-2 pb-1">
            Offline — {groupedUsers().offline.length}
          </h4>
          <For each={groupedUsers().offline}>
            {(user) => (
              <MemberItem
                user={user}
                isCurrentUser={user.id === currentUserId()}
                isSelected={selectedUser()?.user.id === user.id}
                onClick={(rect) => handleMemberClick(user, rect)}
              />
            )}
          </For>
        </div>
      </div>

      <div class="border-t border-white/6 px-3 py-3">
        <Show when={localVoice().inVoice}>
          <VoiceControlsRow />
        </Show>

        <Switch>
          <Match when={localVoice().inVoice}>
            <Button variant="danger" class="w-full" onClick={leaveVoice}>
              <span class="flex items-center justify-center gap-2">
                <TbOutlinePhoneX class="w-4 h-4" />
                Leave
              </span>
            </Button>
          </Match>
          <Match when={showConnecting()}>
            <Button variant="secondary" class="w-full" disabled>
              <span class="flex items-center justify-center gap-2">
                <TbOutlineHeadset class="w-4 h-4 animate-pulse" />
                Connecting...
              </span>
            </Button>
          </Match>
          <Match when={true}>
            <Button
              variant="primary"
              class="w-full"
              onClick={handleJoinVoice}
              disabled={!canJoinVoice()}
            >
              <span class="flex items-center justify-center gap-2">
                <TbOutlineHeadset class="w-4 h-4" />
                {isServerUnavailable() ? "Unavailable" : "Join Voice"}
              </span>
            </Button>
          </Match>
        </Switch>
      </div>

      <UserCard
        user={selectedUser()?.user}
        isOpen={selectedUser() !== null}
        onClose={handleCloseUserCard}
        anchorRect={selectedUser()?.rect ?? null}
        isCurrentUser={selectedUser()?.user?.id === currentUserId()}
        onWatch={
          selectedUser()?.user && localVoice().inVoice
            ? () => handleWatchStream(selectedUser()?.user.id ?? "")
            : undefined
        }
      />
    </div>
  )
}

export default Sidebar
