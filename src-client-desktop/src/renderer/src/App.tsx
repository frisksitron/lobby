import { type Component, Match, onMount, Show, Suspense, Switch } from "solid-js"
import AuthView from "./components/AuthView"
import Header from "./components/Header/Header"
import MessageFeed from "./components/MessageFeed/MessageFeed"
import MessageInput from "./components/MessageInput/MessageInput"
import TypingIndicator from "./components/MessageInput/TypingIndicator"
import ServerSettingsModal from "./components/modals/ServerSettingsModal"
import SettingsModal from "./components/modals/SettingsModal"
import Sidebar from "./components/Sidebar/Sidebar"
import ConfirmDialog from "./components/shared/ConfirmDialog"
import { useConnection, useServers } from "./stores/core"
import { useSettings } from "./stores/settings"
import { useTheme } from "./stores/theme"
import { useUI } from "./stores/ui"

const MainUI: Component = () => (
  <>
    <main class="flex-1 flex flex-col min-w-0 overflow-hidden">
      <MessageFeed />
      <TypingIndicator />
      <MessageInput />
    </main>
    <Sidebar />
  </>
)

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

  const showAuth = () => connection.needsAuth() || connection.connectionState() === "disconnected"

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
    </div>
  )
}

export default AppContent
