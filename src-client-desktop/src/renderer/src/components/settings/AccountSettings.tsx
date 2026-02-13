import { useNavigate } from "@solidjs/router"
import { type Component, createEffect, createSignal } from "solid-js"
import { leaveServer as apiLeaveServer, updateMe } from "../../lib/api/auth"
import { getValidToken } from "../../lib/auth/token-manager"
import { createLogger } from "../../lib/logger"
import { useConnection } from "../../stores/connection"
import { useServers } from "../../stores/servers"
import { useUI } from "../../stores/ui"
import Button from "../shared/Button"
import FormField, { INPUT_CLASS } from "../shared/FormField"

const log = createLogger("AccountSettings")

const AccountSettings: Component = () => {
  const navigate = useNavigate()
  const { currentUser, getServerUrl, updateCurrentUser, disconnect } = useConnection()
  const { activeServer, activeServerId, leaveServer } = useServers()
  const { showConfirmDialog, closeConfirmDialog } = useUI()

  const [username, setUsername] = createSignal("")
  const [isSaving, setIsSaving] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string | null>(null)
  const [leaveError, setLeaveError] = createSignal<string | null>(null)

  createEffect(() => {
    const user = currentUser()
    setUsername(user?.username || "")
    setSaveError(null)
    setLeaveError(null)
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
        <h3 class="text-xs font-semibold text-text-secondary uppercase mb-3">Server</h3>
        <Button variant="danger" onClick={handleLeaveServer}>
          Leave Server
        </Button>
        {leaveError() && <p class="text-red-500 text-sm mt-2">{leaveError()}</p>}
        <p class="text-text-secondary text-sm mt-2">
          Remove yourself from this server, you can rejoin later.
        </p>
      </section>
    </>
  )
}

export default AccountSettings
