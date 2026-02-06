import { useParams } from "@solidjs/router"
import { type Component, createEffect, on } from "solid-js"
import MessageFeed from "../components/MessageFeed/MessageFeed"
import MessageInput from "../components/MessageInput/MessageInput"
import TypingIndicator from "../components/MessageInput/TypingIndicator"
import Sidebar from "../components/Sidebar/Sidebar"
import StreamViewerContainer from "../components/StreamViewer/StreamViewerContainer"
import { connectionService } from "../lib/connection"

const ServerView: Component = () => {
  const params = useParams()

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
    <>
      <Sidebar />
      <main class="flex-1 flex flex-col min-w-0 overflow-hidden">
        <StreamViewerContainer />
        <MessageFeed />
        <TypingIndicator />
        <MessageInput />
      </main>
    </>
  )
}

export default ServerView
