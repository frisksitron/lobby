import "./styles/global.css"
import { render } from "solid-js/web"
import { loadServers, servers } from "./stores/servers"
import { loadSettings } from "./stores/settings"
import { loadTheme } from "./stores/theme"

async function boot() {
  await Promise.all([loadTheme(), loadSettings(), loadServers()])

  const serverList = servers()
  if (serverList.length > 0) {
    const settings = await window.api.settings.getAll()
    const lastServerId = settings.lastActiveServerId
    const target = lastServerId ? serverList.find((s) => s.id === lastServerId) : serverList[0]
    if (target) {
      window.location.hash = `#/server/${target.id}`
    }
  }

  const { default: App } = await import("./App")
  render(() => <App />, document.getElementById("root") as HTMLElement)
}

boot()
