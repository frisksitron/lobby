import type { Component } from "solid-js"
import { useUpdater } from "../stores/updater"

const UpdateBanner: Component = () => {
  const { updateReady, installUpdate, dismiss } = useUpdater()

  return (
    <div class="flex items-center justify-center gap-3 px-4 py-1.5 bg-green-600 text-white text-sm">
      <span>Update v{updateReady()?.version} is ready to install</span>
      <button
        type="button"
        onClick={installUpdate}
        class="px-2.5 py-0.5 rounded bg-white/20 hover:bg-white/30 font-medium transition-colors cursor-pointer"
      >
        Restart
      </button>
      <button
        type="button"
        onClick={dismiss}
        class="px-2.5 py-0.5 rounded hover:bg-white/10 transition-colors cursor-pointer"
      >
        Later
      </button>
    </div>
  )
}

export default UpdateBanner
