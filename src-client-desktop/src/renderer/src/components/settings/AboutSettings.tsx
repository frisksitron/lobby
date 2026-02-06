import { type Component, createEffect, createSignal, onCleanup, Show } from "solid-js"

type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number }
  | { state: "ready"; version: string }
  | { state: "up-to-date" }
  | { state: "error"; message: string }

const AboutSettings: Component = () => {
  const [status, setStatus] = createSignal<UpdateStatus>({ state: "idle" })

  createEffect(() => {
    const cleanups = [
      window.api.updater.onChecking(() => setStatus({ state: "checking" })),
      window.api.updater.onAvailable((info) =>
        setStatus({ state: "available", version: info.version })
      ),
      window.api.updater.onNotAvailable(() => setStatus({ state: "up-to-date" })),
      window.api.updater.onProgress((progress) =>
        setStatus({ state: "downloading", percent: progress.percent })
      ),
      window.api.updater.onDownloaded((info) =>
        setStatus({ state: "ready", version: info.version })
      ),
      window.api.updater.onError((error) => setStatus({ state: "error", message: error }))
    ]

    onCleanup(() => {
      for (const cleanup of cleanups) cleanup()
    })
  })

  const checkForUpdates = async () => {
    setStatus({ state: "checking" })
    const result = await window.api.updater.check()
    if (!result.success && result.error) {
      setStatus({ state: "error", message: result.error })
    }
  }

  const installUpdate = () => {
    window.api.updater.install()
  }

  const statusText = () => {
    const s = status()
    switch (s.state) {
      case "idle":
        return null
      case "checking":
        return "Checking for updates..."
      case "available":
        return `Update v${s.version} available, downloading...`
      case "downloading":
        return `Downloading update... ${Math.round(s.percent)}%`
      case "ready":
        return `Update v${s.version} ready to install`
      case "up-to-date":
        return "You're up to date!"
      case "error":
        return `Update failed: ${s.message}`
    }
  }

  return (
    <div class="space-y-4">
      <div class="text-sm text-text-secondary">
        <p class="text-text-primary font-medium">Lobby v{__APP_VERSION__}</p>
        <p class="mt-2">
          Electron {window.electron.process.versions.electron} · Chrome{" "}
          {window.electron.process.versions.chrome} · Node {window.electron.process.versions.node}
        </p>
      </div>

      <div class="border-t border-border pt-4">
        <div class="flex items-center gap-3">
          <Show
            when={status().state !== "ready"}
            fallback={
              <button
                type="button"
                onClick={installUpdate}
                class="px-3 py-1.5 text-sm font-medium rounded bg-green-600 hover:bg-green-500 text-white transition-colors"
              >
                Restart to Update
              </button>
            }
          >
            <button
              type="button"
              onClick={checkForUpdates}
              disabled={status().state === "checking" || status().state === "downloading"}
              class="px-3 py-1.5 text-sm font-medium rounded bg-bg-tertiary hover:bg-bg-secondary text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Check for Updates
            </button>
          </Show>

          <Show when={status().state === "downloading"}>
            <div class="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                class="h-full bg-accent-primary transition-all duration-300"
                style={{
                  width: `${(status() as { state: "downloading"; percent: number }).percent}%`
                }}
              />
            </div>
          </Show>
        </div>

        <Show when={statusText()}>
          <p
            class="mt-2 text-sm"
            classList={{
              "text-text-secondary": !["error", "ready"].includes(status().state),
              "text-red-400": status().state === "error",
              "text-green-400": status().state === "ready"
            }}
          >
            {statusText()}
          </p>
        </Show>
      </div>
    </div>
  )
}

export default AboutSettings
