import { TbOutlineArrowLeft } from "solid-icons/tb"
import { type Component, createEffect, createSignal, Match, Show, Switch } from "solid-js"
import { useAuthFlow } from "../stores/auth-flow"
import { useConnection } from "../stores/connection"
import Button from "./shared/Button"

const Spinner: Component = () => (
  <div class="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
)

const AuthView: Component = () => {
  const authFlow = useAuthFlow()
  const connection = useConnection()

  const [serverUrlInput, setServerUrlInput] = createSignal("")
  const [emailInput, setEmailInput] = createSignal("")
  const [usernameInput, setUsernameInput] = createSignal("")
  const [codeInput, setCodeInput] = createSignal("")

  // Start auth flow when view is shown (needs_auth or disconnected)
  createEffect(() => {
    if (connection.needsAuth() || connection.connectionState() === "disconnected") {
      authFlow.startAuthFlow(connection.currentServer()).then(() => {
        setEmailInput(authFlow.pendingEmail() || "")
      })
      setServerUrlInput("")
      setUsernameInput("")
      setCodeInput("")
    }
  })

  const handleServerSubmit = (e: Event) => {
    e.preventDefault()
    authFlow.connectToServer(serverUrlInput())
  }

  const handleEmailSubmit = (e: Event) => {
    e.preventDefault()
    authFlow.startEmailAuth(emailInput())
  }

  const handleRegisterSubmit = async (e: Event) => {
    e.preventDefault()
    const result = await authFlow.completeRegistration(usernameInput())
    if (result) {
      await connection.onAuthSuccess(
        result.user,
        result.serverUrl,
        result.serverInfo,
        result.tokens
      )
    }
  }

  const getTitle = () => {
    switch (authFlow.step()) {
      case "server-url":
        return "Connect to Server"
      case "email-input":
        return "Sign In"
      case "code-input":
        return "Enter Code"
      case "register":
        return "Create Account"
      default:
        return "Sign In"
    }
  }

  const isReauthMode = () => !!connection.currentServer()

  return (
    <div class="flex-1 flex items-center justify-center p-4">
      <div class="bg-surface rounded-lg shadow-xl max-w-md w-full p-6">
        <h2 class="text-lg font-semibold text-text-primary mb-4">{getTitle()}</h2>

        <div class="min-h-[200px]">
          <Switch>
            <Match when={authFlow.step() === "server-url"}>
              <form onSubmit={handleServerSubmit} class="space-y-4">
                <p class="text-sm text-text-secondary">
                  Enter the URL of the Lobby server you want to connect to.
                </p>
                <div>
                  <label class="block text-sm font-medium text-text-secondary mb-1">
                    Server URL
                  </label>
                  <input
                    type="url"
                    value={serverUrlInput()}
                    onInput={(e) => setServerUrlInput(e.currentTarget.value)}
                    placeholder="https://lobby.example.com"
                    class="w-full bg-surface-elevated border border-border rounded px-3 py-2 text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent"
                    required
                  />
                </div>
                <Show when={authFlow.authError()}>
                  <p class="text-sm text-error">{authFlow.authError()}</p>
                </Show>
                <div class="flex justify-end pt-2">
                  <Button type="submit" variant="primary" disabled={authFlow.isLoading()}>
                    {authFlow.isLoading() ? <Spinner /> : "Connect"}
                  </Button>
                </div>
              </form>
            </Match>

            <Match when={authFlow.step() === "email-input"}>
              <form onSubmit={handleEmailSubmit} class="space-y-4">
                <div class="text-center pb-2 border-b border-border">
                  <p class="text-sm text-text-secondary">Connecting to</p>
                  <p class="font-medium text-text-primary">
                    {authFlow.serverInfo()?.name || connection.currentServer()?.name}
                  </p>
                  <p class="text-xs text-text-secondary truncate">
                    {authFlow.serverUrl() || connection.currentServer()?.url}
                  </p>
                </div>

                <p class="text-sm text-text-secondary">
                  Enter your email and we'll send you a login code.
                </p>
                <div>
                  <label class="block text-sm font-medium text-text-secondary mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={emailInput()}
                    onInput={(e) => setEmailInput(e.currentTarget.value)}
                    placeholder="you@example.com"
                    class="w-full bg-surface-elevated border border-border rounded px-3 py-2 text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent"
                    required
                  />
                </div>
                <Show when={authFlow.authError()}>
                  <p class="text-sm text-error">{authFlow.authError()}</p>
                </Show>
                <div class="flex gap-2 justify-between pt-2">
                  <Show when={!isReauthMode()}>
                    <Button variant="ghost" onClick={() => authFlow.goBack(isReauthMode())}>
                      <TbOutlineArrowLeft class="w-4 h-4 mr-1" />
                      Change server
                    </Button>
                  </Show>
                  <Show when={isReauthMode()}>
                    <div />
                  </Show>
                  <Button type="submit" variant="primary" disabled={authFlow.isLoading()}>
                    {authFlow.isLoading() ? <Spinner /> : "Send Code"}
                  </Button>
                </div>
              </form>
            </Match>

            <Match when={authFlow.step() === "code-input"}>
              <div class="flex flex-col items-center py-4 space-y-4">
                <div class="text-center">
                  <p class="text-text-primary font-medium">Check your inbox</p>
                  <p class="text-sm text-text-secondary mt-1">We sent a login code to</p>
                  <p class="text-sm text-text-primary font-medium">{authFlow.pendingEmail()}</p>
                </div>

                <div class="w-full">
                  <input
                    type="text"
                    inputmode="numeric"
                    maxLength={6}
                    value={codeInput()}
                    onInput={(e) => {
                      const digits = e.currentTarget.value.replace(/\D/g, "").slice(0, 6)
                      setCodeInput(digits)
                      e.currentTarget.value = digits
                      if (digits.length === 6) {
                        authFlow.verifyMagicCode(digits).then((result) => {
                          if (result) {
                            connection.onAuthSuccess(
                              result.user,
                              result.serverUrl,
                              result.serverInfo,
                              result.tokens
                            )
                          }
                        })
                      }
                    }}
                    placeholder="000000"
                    class="w-full bg-surface-elevated border border-border rounded px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] text-text-primary placeholder-text-secondary/50 focus:outline-none focus:border-accent"
                  />
                </div>

                <Show when={authFlow.authError()}>
                  <p class="text-sm text-error">{authFlow.authError()}</p>
                </Show>

                <div class="flex flex-col items-center gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => authFlow.startEmailAuth(authFlow.pendingEmail())}
                    class="text-accent hover:underline"
                  >
                    Resend code
                  </button>
                  <button
                    type="button"
                    onClick={() => authFlow.goBack(isReauthMode())}
                    class="text-text-secondary hover:text-text-primary"
                  >
                    Use a different email
                  </button>
                </div>

                <Show when={authFlow.isLoading()}>
                  <Spinner />
                </Show>
              </div>
            </Match>

            <Match when={authFlow.step() === "register"}>
              <form onSubmit={handleRegisterSubmit} class="space-y-4">
                <p class="text-sm text-text-secondary">
                  Choose a username to complete your account setup.
                </p>

                <div>
                  <label class="block text-sm font-medium text-text-secondary mb-1">Email</label>
                  <input
                    type="email"
                    value={authFlow.pendingEmail()}
                    disabled
                    class="w-full bg-surface-elevated/50 border border-border rounded px-3 py-2 text-text-secondary cursor-not-allowed"
                  />
                </div>

                <div>
                  <label class="block text-sm font-medium text-text-secondary mb-1">Username</label>
                  <input
                    type="text"
                    value={usernameInput()}
                    onInput={(e) => setUsernameInput(e.currentTarget.value)}
                    placeholder="Choose a username"
                    class="w-full bg-surface-elevated border border-border rounded px-3 py-2 text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent"
                    minLength={3}
                    required
                  />
                </div>

                <Show when={authFlow.authError()}>
                  <p class="text-sm text-error">{authFlow.authError()}</p>
                </Show>

                <div class="flex gap-2 justify-between pt-2">
                  <Button variant="ghost" onClick={() => authFlow.goBack(isReauthMode())}>
                    <TbOutlineArrowLeft class="w-4 h-4 mr-1" />
                    Back
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={authFlow.isLoading() || usernameInput().length < 3}
                  >
                    {authFlow.isLoading() ? <Spinner /> : "Complete Registration"}
                  </Button>
                </div>
              </form>
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  )
}

export default AuthView
