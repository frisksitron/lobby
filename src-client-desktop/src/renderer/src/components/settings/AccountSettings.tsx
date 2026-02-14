import { useNavigate } from "@solidjs/router"
import { type Component, createEffect, createSignal, Show } from "solid-js"
import { leaveServer as apiLeaveServer, updateMe } from "../../lib/api/auth"
import { ApiError } from "../../lib/api/types"
import { uploadAvatar } from "../../lib/api/uploads"
import { getValidToken } from "../../lib/auth/token-manager"
import { formatUploadTooLargeMessage, toValidMaxBytes } from "../../lib/files"
import { createLogger } from "../../lib/logger"
import { useConnection } from "../../stores/connection"
import { useServers } from "../../stores/servers"
import { useUI } from "../../stores/ui"
import Avatar from "../shared/Avatar"
import Button from "../shared/Button"
import FormField, { INPUT_CLASS } from "../shared/FormField"

const log = createLogger("AccountSettings")

const AccountSettings: Component = () => {
  const navigate = useNavigate()
  const { currentUser, currentServer, getServerUrl, updateCurrentUser, disconnect } =
    useConnection()
  const { activeServer, activeServerId, leaveServer } = useServers()
  const { showConfirmDialog, closeConfirmDialog } = useUI()

  const [username, setUsername] = createSignal("")
  const [isSaving, setIsSaving] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string | null>(null)
  const [leaveError, setLeaveError] = createSignal<string | null>(null)

  const [isUploadingAvatar, setIsUploadingAvatar] = createSignal(false)
  const [avatarError, setAvatarError] = createSignal<string | null>(null)

  const getUploadMaxBytes = (): number | null => {
    return toValidMaxBytes(currentServer()?.info?.uploadMaxBytes)
  }

  createEffect(() => {
    const user = currentUser()
    setUsername(user?.username || "")
    setSaveError(null)
    setLeaveError(null)
    setAvatarError(null)
  })

  const handleSaveUsername = async () => {
    const newUsername = username().trim()
    if (!newUsername) {
      setSaveError("Username cannot be empty")
      return
    }

    const user = currentUser()
    if (newUsername === user?.username) {
      return
    }

    setIsSaving(true)
    setSaveError(null)

    try {
      const serverUrl = getServerUrl()
      const token = await getValidToken()

      if (!serverUrl || !token) {
        setSaveError("Not authenticated")
        setIsSaving(false)
        return
      }

      const updatedUser = await updateMe(serverUrl, token, {
        username: newUsername
      })

      updateCurrentUser(updatedUser)
    } catch (error) {
      log.error("Failed to update username:", error)
      setSaveError("Failed to update username")
    } finally {
      setIsSaving(false)
    }
  }

  const handleAvatarFile = async (file: File | undefined): Promise<void> => {
    if (!file) return

    const uploadMaxBytes = getUploadMaxBytes()
    if (uploadMaxBytes !== null && file.size > uploadMaxBytes) {
      setAvatarError(formatUploadTooLargeMessage(uploadMaxBytes, "Image"))
      return
    }

    setIsUploadingAvatar(true)
    setAvatarError(null)

    try {
      const updatedUser = await uploadAvatar(file)
      updateCurrentUser(updatedUser)
    } catch (error) {
      log.error("Failed to upload avatar:", error)
      if (error instanceof ApiError && error.code === "PAYLOAD_TOO_LARGE") {
        const maxBytes = getUploadMaxBytes()
        setAvatarError(formatUploadTooLargeMessage(maxBytes, "Image"))
      } else {
        setAvatarError("Failed to upload avatar")
      }
    } finally {
      setIsUploadingAvatar(false)
    }
  }

  const handleLeaveServer = () => {
    const server = activeServer()
    if (!server) return

    setLeaveError(null)

    showConfirmDialog({
      title: "Leave Server",
      message: `Are you sure you want to leave "${server.name}"? You'll lose access to all messages and voice channels in this server.`,
      confirmLabel: "Leave Server",
      variant: "danger",
      onConfirm: async () => {
        try {
          const serverUrl = getServerUrl()
          const token = await getValidToken()

          if (!serverUrl || !token) {
            setLeaveError("Not authenticated. Sign in and try again.")
            closeConfirmDialog()
            return
          }

          await apiLeaveServer(serverUrl, token)

          const nextServerId = await leaveServer(activeServerId())
          closeConfirmDialog()
          if (nextServerId) {
            navigate(`/server/${nextServerId}`)
          } else {
            await disconnect()
            navigate("/auth")
          }
        } catch (error) {
          log.error("Failed to leave server:", error)
          setLeaveError("Failed to leave server")
          closeConfirmDialog()
        }
      }
    })
  }

  return (
    <>
      <section>
        <h3 class="text-xs font-semibold text-text-secondary uppercase mb-3">Your Profile</h3>

        <div class="mb-4 flex items-center gap-3">
          <Avatar
            name={currentUser()?.username || "User"}
            imageUrl={currentUser()?.avatarUrl}
            size="lg"
          />

          <label class="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary cursor-pointer">
            <input
              type="file"
              accept="image/*"
              class="hidden"
              disabled={isUploadingAvatar()}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                void handleAvatarFile(file)
                event.currentTarget.value = ""
              }}
            />
            <span class="rounded border border-border px-2.5 py-1.5 hover:bg-surface transition-colors">
              {isUploadingAvatar() ? "Uploading..." : "Change Avatar"}
            </span>
          </label>
        </div>
        <Show when={avatarError()}>
          {(error) => <p class="text-red-500 text-sm mb-3">{error()}</p>}
        </Show>

        <FormField label="Username" error={saveError() || undefined}>
          <div class="flex gap-2">
            <input
              type="text"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              class={`flex-1 ${INPUT_CLASS.replace("w-full ", "")}`}
              placeholder="Enter username"
            />
            <Button
              variant="primary"
              onClick={handleSaveUsername}
              disabled={isSaving() || username().trim() === currentUser()?.username}
            >
              Save
            </Button>
          </div>
        </FormField>
      </section>

      <section>
        <div>
          <h4 class="text-xs font-semibold text-error uppercase mb-2">Danger Zone</h4>
          <Button variant="danger" onClick={handleLeaveServer}>
            Leave Server
          </Button>
          {leaveError() && <p class="text-red-500 text-sm mt-2">{leaveError()}</p>}
          <p class="text-text-secondary text-sm mt-2">
            Remove yourself from this server, you can rejoin later.
          </p>
        </div>
      </section>
    </>
  )
}

export default AccountSettings
