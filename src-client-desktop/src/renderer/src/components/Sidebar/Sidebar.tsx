import {
  TbOutlineHeadphones,
  TbOutlineHeadphonesOff,
  TbOutlineHeadset,
  TbOutlineMicrophone,
  TbOutlineMicrophoneOff,
  TbOutlinePhoneX,
  TbOutlineVolume
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
import { audioManager } from "../../lib/webrtc"
import { useConnection, useSession, useUsers } from "../../stores/core"
import { useSettings } from "../../stores/settings"
import Button from "../shared/Button"
import ButtonWithIcon from "../shared/ButtonWithIcon"
import UserIdentity from "../shared/UserIdentity"
import UserCard from "./UserCard"

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
      class="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer hover:bg-surface-elevated"
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
  const { getUserVolume } = useSettings()

  const handleClick = () => {
    if (itemRef) {
      props.onClick(itemRef.getBoundingClientRect())
    }
  }

  const volume = () => getUserVolume(props.user.id)
  const showVolumeBadge = () => !props.isCurrentUser && volume() !== 100

  return (
    <div
      ref={itemRef}
      class="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer hover:bg-surface-elevated/50"
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
      <Show when={showVolumeBadge()}>
        <div class="flex items-center gap-0.5 text-xs text-text-secondary">
          <TbOutlineVolume class="w-3 h-3" />
          <span>{volume()}%</span>
        </div>
      </Show>
      <Switch>
        <Match when={props.user.voiceDeafened}>
          <div class="ml-auto">
            <TbOutlineHeadphonesOff class="w-4 h-4 text-error" />
          </div>
        </Match>
        <Match when={props.user.voiceMuted}>
          <div class="ml-auto">
            <TbOutlineMicrophoneOff class="w-4 h-4 text-error" />
          </div>
        </Match>
      </Switch>
    </div>
  )
}

const VoiceControlsRow: Component = () => {
  const { localVoice, toggleMute, toggleDeafen, leaveVoice } = useSession()

  return (
    <div class="flex items-center gap-2">
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

      <Button variant="danger" class="flex-1" onClick={leaveVoice}>
        <span class="flex items-center justify-center gap-2">
          <TbOutlinePhoneX class="w-4 h-4" />
          Leave
        </span>
      </Button>
    </div>
  )
}

const Sidebar: Component = () => {
  const { localVoice, joinVoice, session } = useSession()
  const { isServerUnavailable, currentUser } = useConnection()
  const { getAllUsers } = useUsers()
  const { settings } = useSettings()

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

  return (
    <div class="w-60 bg-surface border-l border-border flex flex-col h-full">
      <div class="border-b border-border">
        <div class="px-3 p-3">
          <Show
            when={localVoice().inVoice}
            fallback={
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
            }
          >
            <VoiceControlsRow />
          </Show>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-2">
        <div class="mb-4">
          <h4 class="text-xs font-semibold text-text-secondary uppercase px-3 mb-1">
            Online - {groupedUsers().voiceOnline.length + groupedUsers().online.length}
          </h4>

          <Show when={groupedUsers().voiceOnline.length > 0}>
            <div class="ring-1 ring-accent/50 rounded-lg bg-linear-to-br from-accent/10 to-surface/50">
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

        <div>
          <h4 class="text-xs font-semibold text-text-secondary uppercase px-3 mb-1">
            Offline - {groupedUsers().offline.length}
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

      <UserCard
        user={selectedUser()?.user}
        isOpen={selectedUser() !== null}
        onClose={handleCloseUserCard}
        anchorRect={selectedUser()?.rect ?? null}
        isCurrentUser={selectedUser()?.user?.id === currentUserId()}
      />
    </div>
  )
}

export default Sidebar
