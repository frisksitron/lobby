import { type Component, createSignal, Show } from "solid-js"
import { ApiError } from "../../lib/api/types"
import { uploadServerImage } from "../../lib/api/uploads"
import { formatUploadTooLargeMessage, toValidMaxBytes } from "../../lib/files"
import { createLogger } from "../../lib/logger"
import { useConnection } from "../../stores/connection"
import { useServers } from "../../stores/servers"

const log = createLogger("ServerSettings")

const ServerSettings: Component = () => {
  const { currentServer } = useConnection()
  const { activeServerId, updateServerIcon } = useServers()

  const [isUploadingServerImage, setIsUploadingServerImage] = createSignal(false)
  const [serverImageError, setServerImageError] = createSignal<string | null>(null)

  const getUploadMaxBytes = (): number | null => {
    return toValidMaxBytes(currentServer()?.info?.uploadMaxBytes)
  }

  const handleServerImageFile = async (file: File | undefined): Promise<void> => {
    if (!file) return

    const uploadMaxBytes = getUploadMaxBytes()
    if (uploadMaxBytes !== null && file.size > uploadMaxBytes) {
      setServerImageError(formatUploadTooLargeMessage(uploadMaxBytes, "Image"))
      return
    }

    setIsUploadingServerImage(true)
    setServerImageError(null)

    try {
      const info = await uploadServerImage(file)
      const serverId = activeServerId()
      if (serverId) {
        await updateServerIcon(serverId, info.iconUrl)
      }
    } catch (error) {
      log.error("Failed to upload server image:", error)
      if (error instanceof ApiError && error.code === "PAYLOAD_TOO_LARGE") {
        const maxBytes = getUploadMaxBytes()
        setServerImageError(formatUploadTooLargeMessage(maxBytes, "Image"))
      } else {
        setServerImageError("Failed to upload server image")
      }
    } finally {
      setIsUploadingServerImage(false)
    }
  }

  return (
    <section>
      <h4 class="text-xs font-semibold text-text-secondary uppercase mb-2">Server Image</h4>
      <label class="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary cursor-pointer mb-2">
        <input
          type="file"
          accept="image/*"
          class="hidden"
          disabled={isUploadingServerImage()}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            void handleServerImageFile(file)
            event.currentTarget.value = ""
          }}
        />
        <span class="rounded border border-border px-2.5 py-1.5 hover:bg-surface transition-colors">
          {isUploadingServerImage() ? "Uploading..." : "Update Server Image"}
        </span>
      </label>
      <Show when={serverImageError()}>
        {(error) => <p class="text-red-500 text-sm mb-2">{error()}</p>}
      </Show>
    </section>
  )
}

export default ServerSettings
