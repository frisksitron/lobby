import { createSignal } from "solid-js"
import type { Server } from "../../../shared/types"
import { connectionService } from "../lib/connection"
import { createLogger } from "../lib/logger"
import { clearTokens } from "../lib/storage"

const log = createLogger("Servers")

const [servers, setServers] = createSignal<Server[]>([])

export { servers }

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

export async function leaveServer(serverId: string): Promise<string | null> {
  const currentServers = servers()
  const newServers = currentServers.filter((s) => s.id !== serverId)
  setServers(newServers)
  await clearTokens(serverId)
  await window.api.servers.remove(serverId)

  if (connectionService.getServer()?.id === serverId) {
    return newServers.length > 0 ? newServers[0].id : null
  }
  return connectionService.getServer()?.id ?? null
}

export function useServers() {
  return {
    servers,
    activeServerId: () => connectionService.getServer()?.id ?? "",
    activeServer: () => servers().find((s) => s.id === connectionService.getServer()?.id),
    leaveServer
  }
}
