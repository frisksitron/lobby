import { useParams } from "@solidjs/router"
import { type Component, createEffect, on, Show } from "solid-js"
import MessageFeed from "../components/MessageFeed/MessageFeed"
import MessageInput from "../components/MessageInput/MessageInput"
import TypingIndicator from "../components/MessageInput/TypingIndicator"
import Sidebar from "../components/Sidebar/Sidebar"
import StreamViewerContainer from "../components/StreamViewer/StreamViewerContainer"
import { connectionService } from "../lib/connection"
import { useConnection } from "../stores/connection"
import ConnectionStatusView from "./ConnectionStatusView"

const ServerView: Component = () => {
  const params = useParams()
  const connection = useConnection()

  createEffect(
    on(
      () => params.serverId,
      (serverId) => {
        if (serverId) {
          connectionService.connectToServer(serverId)
        }
      }
    )
  )

  return (
    <Show when={connection.connectionState() === "connected"} fallback={<ConnectionStatusView />}>
      <Sidebar />
      <main class="flex-1 flex flex-col min-w-0 overflow-hidden">
        <StreamViewerContainer />
        <MessageFeed />
        <TypingIndicator />
        <MessageInput />
      </main>
    </Show>
  )
}

export default ServerView
