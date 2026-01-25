import { type Component, onMount, Show } from "solid-js"
import AuthView from "./components/AuthView"
import Header from "./components/Header/Header"
import MessageFeed from "./components/MessageFeed/MessageFeed"
import MessageInput from "./components/MessageInput/MessageInput"
import TypingIndicator from "./components/MessageInput/TypingIndicator"
import ServerSettingsModal from "./components/modals/ServerSettingsModal"
import SettingsModal from "./components/modals/SettingsModal"
import Sidebar from "./components/Sidebar/Sidebar"
import ConfirmDialog from "./components/shared/ConfirmDialog"
import ToastContainer from "./components/shared/Toast"
import { useConnection } from "./stores/connection"
import { useTheme } from "./stores/theme"
import { useUI } from "./stores/ui"

// Loading screen component
const LoadingScreen: Component<{ message?: string }> = (props) => (
  <div class="h-screen flex items-center justify-center bg-background">
    <div class="flex flex-col items-center gap-4">
      <div class="w-8 h-8 border-2 border-text-secondary border-t-accent rounded-full animate-spin" />
      <p class="text-text-secondary text-sm">{props.message || "Loading..."}</p>
    </div>
  </div>
)

const App: Component = () => {
  const {
    activeModal,
    closeModal,
    serverDropdownOpen,
    closeServerDropdown,
    confirmDialog,
    closeConfirmDialog
  } = useUI()
  const connection = useConnection()
  const { loadTheme } = useTheme()

  // Initialize on app start
  onMount(async () => {
    await loadTheme()
    connection.initialize()
  })

  // Close dropdown when clicking outside
  const handleMainClick = () => {
    if (serverDropdownOpen()) {
      closeServerDropdown()
    }
  }

  return (
    <Show when={!connection.isInitializing()} fallback={<LoadingScreen />}>
      <Show
        when={!(connection.isServerUnavailable() && !connection.currentUser())}
        fallback={<LoadingScreen message="Reconnecting..." />}
      >
        <div class="h-screen flex flex-col bg-background" onClick={handleMainClick}>
          <Header />

          <div class="flex-1 flex overflow-hidden">
            <Show
              when={!connection.needsAuth() && connection.connectionState() !== "disconnected"}
              fallback={<AuthView />}
            >
              <main class="flex-1 flex flex-col min-w-0">
                <MessageFeed />
                <TypingIndicator />
                <MessageInput />
              </main>

              <Sidebar />
            </Show>
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
          <ToastContainer />
        </div>
      </Show>
    </Show>
  )
}

export default App
