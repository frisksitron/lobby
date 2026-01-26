import { type Component, createEffect, createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { useServers } from "../../stores/connection"
import { useMessages } from "../../stores/messages"
import { useSession } from "../../stores/session"
import { computeMessageGrouping } from "./groupMessages"
import Message from "./Message"

const MessageFeed: Component = () => {
  let feedRef: HTMLDivElement | undefined
  let sentinelRef: HTMLDivElement | undefined
  let isUserNearBottom = true
  let isLoadingMore = false

  const {
    getMessagesForServer,
    loadHistory,
    setupMessageListener,
    isLoadingHistory,
    hasMoreHistory,
    isInitialLoadComplete,
    messages: allMessages
  } = useMessages()
  const { activeServerId } = useServers()
  const { session } = useSession()

  const messages = (): ReturnType<typeof getMessagesForServer> => {
    const serverId = activeServerId()
    return serverId ? getMessagesForServer(serverId) : []
  }

  const groupedMessages = createMemo(() => computeMessageGrouping(messages()))

  const scrollToBottom = (): void => {
    if (feedRef) {
      feedRef.scrollTop = feedRef.scrollHeight
    }
  }

  const checkIfNearBottom = (): boolean => {
    if (!feedRef) return true
    const threshold = 100 // pixels from bottom
    return feedRef.scrollHeight - feedRef.scrollTop - feedRef.clientHeight < threshold
  }

  const handleScroll = (): void => {
    isUserNearBottom = checkIfNearBottom()
  }

  // Load more messages when scrolling to top
  const loadMoreMessages = async (): Promise<void> => {
    if (isLoadingMore || !hasMoreHistory() || isLoadingHistory()) return

    const currentMessages = messages()
    const oldestMessage = currentMessages[0]
    if (!oldestMessage || !feedRef) return

    isLoadingMore = true
    const scrollHeightBefore = feedRef.scrollHeight
    const scrollTopBefore = feedRef.scrollTop

    await loadHistory(oldestMessage.id)

    // Preserve scroll position after prepending messages
    requestAnimationFrame(() => {
      if (feedRef) {
        const heightDiff = feedRef.scrollHeight - scrollHeightBefore
        feedRef.scrollTop = scrollTopBefore + heightDiff
      }
      isLoadingMore = false
    })
  }

  // Setup message listener on mount
  onMount(() => {
    const cleanups = setupMessageListener()
    onCleanup(() => {
      for (const fn of cleanups) fn()
    })

    // Setup scroll listener
    if (feedRef) {
      feedRef.addEventListener("scroll", handleScroll)
      onCleanup(() => feedRef?.removeEventListener("scroll", handleScroll))
    }
  })

  // Setup IntersectionObserver for infinite scroll
  onMount(() => {
    if (!sentinelRef) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (
          entry.isIntersecting &&
          hasMoreHistory() &&
          !isLoadingHistory() &&
          isInitialLoadComplete()
        ) {
          loadMoreMessages()
        }
      },
      {
        root: feedRef,
        rootMargin: "100px 0px 0px 0px",
        threshold: 0
      }
    )

    observer.observe(sentinelRef)
    onCleanup(() => observer.disconnect())
  })

  // Trigger initial load when connected
  createEffect(() => {
    if (session()?.status === "connected" && !isInitialLoadComplete()) {
      loadHistory().then(() => {
        requestAnimationFrame(() => scrollToBottom())
      })
    }
  })

  // Auto-scroll for new messages only when user is near bottom
  createEffect((prevLength: number) => {
    const currentLength = allMessages().length

    // Only scroll if new messages were added (not prepended) and user is near bottom
    if (currentLength > prevLength && isUserNearBottom && isInitialLoadComplete()) {
      requestAnimationFrame(() => scrollToBottom())
    }

    return currentLength
  }, 0)

  return (
    <div ref={feedRef} class="flex-1 min-w-0 overflow-y-auto overflow-x-hidden py-2">
      <div ref={sentinelRef} class="h-1" />

      <Show when={isLoadingHistory() && isInitialLoadComplete()}>
        <div class="flex justify-center py-4">
          <div class="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      </Show>

      <Show when={!hasMoreHistory() && messages().length > 0}>
        <div class="py-4 text-center text-sm text-text-secondary">Beginning of conversation</div>
      </Show>

      <Show when={!isInitialLoadComplete() && session()?.status === "connected"}>
        <div class="flex h-full items-center justify-center">
          <div class="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      </Show>

      <For
        each={groupedMessages()}
        fallback={
          <Show when={isInitialLoadComplete()}>
            <div class="p-4 text-center text-text-secondary">No messages yet</div>
          </Show>
        }
      >
        {(item) => (
          <Message
            message={item.message}
            isFirstInGroup={item.isFirstInGroup}
            isLastInGroup={item.isLastInGroup}
          />
        )}
      </For>
    </div>
  )
}

export default MessageFeed
