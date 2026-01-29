import { type Component, createEffect, createSignal } from "solid-js"
import { updateMe } from "../../lib/api/auth"
import { getValidToken } from "../../lib/auth/token-manager"
import { createLogger } from "../../lib/logger"
import { useConnection, useServers } from "../../stores/core"
import { useUI } from "../../stores/ui"
import Button from "../shared/Button"
import FormField, { INPUT_CLASS } from "../shared/FormField"
import Modal from "../shared/Modal"

const log = createLogger("ServerSettings")

interface ServerSettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

const ServerSettingsModal: Component<ServerSettingsModalProps> = (props) => {
  const { currentUser, getServerUrl, updateCurrentUser } = useConnection()
  const { activeServer, activeServerId, leaveServer } = useServers()
  const { showConfirmDialog, closeConfirmDialog } = useUI()

  const [username, setUsername] = createSignal("")
  const [isSaving, setIsSaving] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string | null>(null)

  // Reset username field when modal opens
  createEffect(() => {
    if (props.isOpen) {
      const user = currentUser()
      setUsername(user?.username || "")
      setSaveError(null)
    }
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

      // Update username
      const updatedUser = await updateMe(serverUrl, token, {
        username: newUsername,
        displayName: newUsername
      })

      // Update local state
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

    showConfirmDialog({
      title: "Leave Server",
      message: `Are you sure you want to leave "${server.name}"? You'll lose access to all messages and voice channels in this server.`,
      confirmLabel: "Leave Server",
      variant: "danger",
      onConfirm: async () => {
        await leaveServer(activeServerId())
        closeConfirmDialog()
        props.onClose()
      }
    })
  }

  const footer = (
    <div class="flex justify-end">
      <Button variant="primary" onClick={props.onClose}>
        Done
      </Button>
    </div>
  )

  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} title="Account" footer={footer}>
      <div class="space-y-6 pb-12 pr-4">
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
          <h3 class="text-xs font-semibold text-text-secondary uppercase mb-3">Account</h3>
          <Button variant="danger" onClick={handleLeaveServer}>
            Leave Server
          </Button>
          <p class="text-text-secondary text-sm mt-2">
            Remove yourself from this server, you can rejoin later.
          </p>
        </section>
      </div>
    </Modal>
  )
}

export default ServerSettingsModal
