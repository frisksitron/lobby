import { createRoot, createSignal, useTransition } from "solid-js"
import type { Server } from "../../../shared/types"
import { createLogger } from "../lib/logger"

const log = createLogger("Servers")

const [servers, setServers] = createSignal<Server[]>([])
const [isServerSwitching, startServerTransition] = createRoot(() => useTransition())

let connectToServerFn: ((serverId: string) => Promise<boolean>) | null = null
let disconnectFn: (() => Promise<void>) | null = null
let getCurrentServerId: () => string | null = () => null

export function initServers(
  connectToServer: (serverId: string) => Promise<boolean>,
  disconnect: () => Promise<void>,
  currentServerIdGetter: () => string | null
): void {
  connectToServerFn = connectToServer
  disconnectFn = disconnect
  getCurrentServerId = currentServerIdGetter
}

export async function loadServers(): Promise<void> {
  try {
    const storedServers = await window.api.servers.getAll()
    const serverList: Server[] = storedServers.map((entry) => ({
      id: entry.id,
      name: entry.name,
      iconUrl: entry.iconUrl,
      ownerId: "",
      memberIds: []
    }))
    setServers(serverList)
  } catch (error) {
    log.error("Failed to load servers from storage:", error)
  }
}

export async function addServerEntry(serverInfo: {
  id: string
  name: string
  url: string
  iconUrl?: string
  email?: string
}): Promise<void> {
  const existing = servers().find((s) => s.id === serverInfo.id)
  if (existing) {
    await window.api.servers.add(serverInfo)
    return
  }

  const newServer: Server = {
    id: serverInfo.id,
    name: serverInfo.name,
    iconUrl: serverInfo.iconUrl,
    ownerId: "",
    memberIds: []
  }
  setServers((prev) => [...prev, newServer])
  await window.api.servers.add({
    id: serverInfo.id,
    name: serverInfo.name,
    url: serverInfo.url,
    iconUrl: serverInfo.iconUrl
  })
}

export function setActiveServer(serverId: string): void {
  if (getCurrentServerId() === serverId) return
  if (!connectToServerFn) return

  const connectFn = connectToServerFn
  startServerTransition(async () => {
    await window.api.settings.set("lastActiveServerId", serverId)
    await connectFn(serverId)
  })
}

export async function leaveServer(serverId: string): Promise<void> {
  const currentServers = servers()
  const newServers = currentServers.filter((s) => s.id !== serverId)
  setServers(newServers)
  await window.api.servers.remove(serverId)

  if (getCurrentServerId() === serverId) {
    if (newServers.length > 0) {
      setActiveServer(newServers[0].id)
    } else if (disconnectFn) {
      await disconnectFn()
    }
  }
}

export { servers, isServerSwitching }

export function useServers() {
  return {
    servers,
    activeServerId: () => getCurrentServerId() ?? "",
    activeServer: () => servers().find((s) => s.id === getCurrentServerId()),
    setActiveServer,
    leaveServer,
    isServerSwitching
  }
}
