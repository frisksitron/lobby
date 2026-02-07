import { type Component, createEffect, createSignal, onCleanup, Show } from "solid-js"
import Button from "../shared/Button"

type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string; releaseNotes?: string }
  | { state: "downloading"; percent: number }
  | { state: "ready"; version: string; releaseNotes?: string }
  | { state: "up-to-date" }
  | { state: "error"; message: string }

const AboutSettings: Component = () => {
  const [status, setStatus] = createSignal<UpdateStatus>({ state: "idle" })

  createEffect(() => {
    const cleanups = [
      window.api.updater.onChecking(() => setStatus({ state: "checking" })),
      window.api.updater.onAvailable((info) =>
        setStatus({ state: "available", version: info.version, releaseNotes: info.releaseNotes })
      ),
      window.api.updater.onNotAvailable(() => setStatus({ state: "up-to-date" })),
      window.api.updater.onProgress((progress) =>
        setStatus({ state: "downloading", percent: progress.percent })
      ),
      window.api.updater.onDownloaded((info) =>
        setStatus({ state: "ready", version: info.version, releaseNotes: info.releaseNotes })
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

  const releaseNotes = () => {
    const s = status()
    if (s.state === "available" || s.state === "ready") return s.releaseNotes
    return undefined
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
        return `Downloading... ${Math.round(s.percent)}%`
      case "ready":
        return `v${s.version} ready to install`
      case "up-to-date":
        return "You're up to date!"
      case "error":
        return `Update failed: ${s.message}`
    }
  }

  return (
    <>
      <section>
        <h3 class="text-xs font-semibold text-text-secondary uppercase mb-3">Version</h3>
        <p class="text-sm text-text-primary font-medium">Lobby v{__APP_VERSION__}</p>
        <p class="text-xs text-text-secondary mt-1">
          Electron {window.electron.process.versions.electron} · Chrome{" "}
          {window.electron.process.versions.chrome} · Node {window.electron.process.versions.node}
        </p>
      </section>

      <section>
        <h3 class="text-xs font-semibold text-text-secondary uppercase mb-3">Updates</h3>
        <Show
          when={status().state !== "ready"}
          fallback={
            <Button
              variant="primary"
              size="sm"
              onClick={installUpdate}
              class="bg-green-600 hover:bg-green-500"
            >
              Restart to Update
            </Button>
          }
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={checkForUpdates}
            disabled={status().state === "checking" || status().state === "downloading"}
          >
            Check for Updates
          </Button>
        </Show>

        <Show when={status().state === "downloading"}>
          <div class="mt-3 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              class="h-full bg-accent-primary rounded-full transition-all duration-300"
              style={{
                width: `${(status() as { state: "downloading"; percent: number }).percent}%`
              }}
            />
          </div>
        </Show>

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

        <Show when={releaseNotes()}>
          <div class="mt-3 border border-border rounded-lg p-3 bg-surface max-h-48 overflow-y-auto">
            <h4 class="text-xs font-semibold text-text-secondary uppercase mb-2">Release Notes</h4>
            <p class="text-sm text-text-primary whitespace-pre-wrap">{releaseNotes()}</p>
          </div>
        </Show>
      </section>
    </>
  )
}

export default AboutSettings
