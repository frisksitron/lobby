import type { Component } from "solid-js"

const AboutSettings: Component = () => {
  return (
    <div class="space-y-4">
      <div class="text-sm text-text-secondary">
        <p class="text-text-primary font-medium">Lobby v{__APP_VERSION__}</p>
        <p class="mt-2">
          Electron {window.electron.process.versions.electron} · Chrome{" "}
          {window.electron.process.versions.chrome} · Node {window.electron.process.versions.node}
        </p>
      </div>
    </div>
  )
}

export default AboutSettings
