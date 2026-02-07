import { createSignal } from "solid-js"

const [updateReady, setUpdateReady] = createSignal<{
  version: string
  releaseNotes?: string
} | null>(null)

window.api.updater.onDownloaded((info) =>
  setUpdateReady({ version: info.version, releaseNotes: info.releaseNotes })
)

export function useUpdater() {
  return {
    updateReady,
    installUpdate: () => window.api.updater.install(),
    dismiss: () => setUpdateReady(null)
  }
}
