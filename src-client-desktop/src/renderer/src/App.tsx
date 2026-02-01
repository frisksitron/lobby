import { type Component, Match, onMount, Show, Suspense, Switch } from "solid-js"
import AuthView from "./components/AuthView"
import ConnectionStatusView from "./components/ConnectionStatusView"
import Header from "./components/Header/Header"
import MessageFeed from "./components/MessageFeed/MessageFeed"
import MessageInput from "./components/MessageInput/MessageInput"
import TypingIndicator from "./components/MessageInput/TypingIndicator"
import ServerSettingsModal from "./components/modals/ServerSettingsModal"
import SettingsModal from "./components/modals/SettingsModal"
import { ScreenPicker } from "./components/ScreenPicker"
import Sidebar from "./components/Sidebar/Sidebar"
import { StreamViewer } from "./components/StreamViewer"
import ConfirmDialog from "./components/shared/ConfirmDialog"
import { shouldShowConnectionOverlay, useConnection } from "./stores/connection"
import { useScreenShare } from "./stores/screen-share"
import { useServers } from "./stores/servers"
import { useSettings } from "./stores/settings"
import { useTheme } from "./stores/theme"
import { useUI } from "./stores/ui"
import { useUsers } from "./stores/users"

const MainUI: Component = () => {
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

  // Only show viewer when streaming OR actively viewing someone
  const shouldShowViewer = () => isLocallySharing() || viewingStreamerId() !== null

  // Viewing takes priority when set, otherwise show own stream if sharing
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
    <>
      <main class="flex-1 flex flex-col min-w-0 overflow-hidden">
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
        <MessageFeed />
        <TypingIndicator />
        <MessageInput />
      </main>
      <Sidebar />
    </>
  )
}

const AppContent: Component = () => {
  const {
    activeModal,
    closeModal,
    serverDropdownOpen,
    closeServerDropdown,
    confirmDialog,
    closeConfirmDialog
  } = useUI()
  const connection = useConnection()
  const { activeServerId } = useServers()
  const { loadTheme } = useTheme()
  const { loadSettings } = useSettings()
  const { isPickerOpen, closeScreenPicker, startScreenShare } = useScreenShare()

  const showAuth = () => connection.needsAuth() || connection.connectionState() === "disconnected"

  const showConnectionOverlay = () => {
    const state = connection.connectionState()
    const detail = connection.connectionDetail()
    // Only show when we have a server context but connection is problematic
    return (
      connection.currentServer() !== null &&
      !showAuth() &&
      shouldShowConnectionOverlay(state, detail)
    )
  }

  onMount(async () => {
    await loadTheme()
    loadSettings()
    connection.initialize()
  })

  const handleMainClick = () => {
    if (serverDropdownOpen()) {
      closeServerDropdown()
    }
  }

  return (
    <div class="h-screen flex flex-col bg-background" onClick={handleMainClick}>
      <Header />

      <div class="flex-1 flex overflow-hidden">
        <Switch>
          <Match when={showAuth()}>
            <AuthView />
          </Match>
          <Match when={showConnectionOverlay()}>
            <ConnectionStatusView />
          </Match>
          <Match when={connection.connectionState() === "connected"}>
            <Suspense fallback={null}>
              <Show when={activeServerId()} keyed>
                {(_serverId) => <MainUI />}
              </Show>
            </Suspense>
          </Match>
        </Switch>
      </div>

      <SettingsModal isOpen={activeModal() === "settings"} onClose={closeModal} />
      <ServerSettingsModal isOpen={activeModal() === "server-settings"} onClose={closeModal} />

      <Show when={confirmDialog()}>
        {(config) => (
          <ConfirmDialog
            isOpen={true}
            title={config().title}
            message={config().message}
            confirmLabel={config().confirmLabel}
            cancelLabel={config().cancelLabel}
            variant={config().variant}
            onConfirm={config().onConfirm}
            onCancel={closeConfirmDialog}
          />
        )}
      </Show>

      <ScreenPicker
        isOpen={isPickerOpen()}
        onClose={closeScreenPicker}
        onSelect={startScreenShare}
      />
    </div>
  )
}

export default AppContent
