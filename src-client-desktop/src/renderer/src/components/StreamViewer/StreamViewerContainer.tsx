import { type Component, Show } from "solid-js"
import { StreamViewer } from "../../components/StreamViewer"
import { useConnection } from "../../stores/connection"
import { useScreenShare } from "../../stores/screen-share"
import { useUsers } from "../../stores/users"

const StreamViewerContainer: Component = () => {
  const {
    remoteStream,
    viewingStreamerId,
    localStream,
    isLocallySharing,
    unsubscribeFromStream,
    stopScreenShare,
    subscribeToStream
  } = useScreenShare()
  const { currentUser } = useConnection()
  const { getActiveStreamers } = useUsers()

  const shouldShowViewer = () => isLocallySharing() || viewingStreamerId() !== null

  const computedStream = () => {
    if (viewingStreamerId()) return remoteStream()
    if (isLocallySharing()) return localStream()
    return null
  }

  const computedStreamerId = () => {
    if (viewingStreamerId()) return viewingStreamerId()
    if (isLocallySharing()) return currentUser()?.id ?? null
    return null
  }

  const isOwnStream = () => isLocallySharing() && !viewingStreamerId()

  const handleClose = () => {
    if (isOwnStream()) {
      stopScreenShare()
    } else {
      unsubscribeFromStream()
    }
  }

  const handleSwitchStream = (streamerId: string) => subscribeToStream(streamerId)
  const handleViewOwnStream = () => unsubscribeFromStream()

  return (
    <Show when={shouldShowViewer()}>
      <StreamViewer
        stream={computedStream()}
        streamerId={computedStreamerId()}
        isOwnStream={isOwnStream()}
        onClose={handleClose}
        availableStreamers={getActiveStreamers()}
        isLocallySharing={isLocallySharing()}
        onSwitchStream={handleSwitchStream}
        onViewOwnStream={handleViewOwnStream}
      />
    </Show>
  )
}

export default StreamViewerContainer
