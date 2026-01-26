import { type Component, createEffect, createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { useServers } from "../../stores/core"
import { useMessages } from "../../stores/messages"
import { computeMessageGrouping } from "./groupMessages"
import Message from "./Message"

const EmptyState = () => <div class="p-4 text-center text-text-secondary">No messages yet</div>

const MessageFeed: Component = () => {
  let feedRef: HTMLDivElement | undefined
  let sentinelRef: HTMLDivElement | undefined
  // Imperative scroll state - intentionally not reactive as these are only
  // used in scroll event handlers and should not trigger re-renders
  let isUserNearBottom = true
  let isLoadingMore = false
  let hasScrolledInitially = false

  const { messages, loadMoreHistory, setupMessageListener, isLoadingHistory, hasMoreHistory } =
    useMessages()
  const { activeServerId } = useServers()

  const currentMessages = () => {
    const serverId = activeServerId()
    return serverId ? messages() : []
  }

  const groupedMessages = createMemo(() => {
    return computeMessageGrouping(currentMessages())
  })

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

    const msgs = currentMessages()
    const oldestMessage = msgs[0]
    if (!oldestMessage || !feedRef) return

    isLoadingMore = true
    const scrollHeightBefore = feedRef.scrollHeight
    const scrollTopBefore = feedRef.scrollTop

    await loadMoreHistory(oldestMessage.id)

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
        if (entry.isIntersecting && hasMoreHistory() && !isLoadingHistory()) {
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

  // Scroll to bottom on initial load
  createEffect(() => {
    const msgs = currentMessages()
    if (msgs.length > 0 && !hasScrolledInitially) {
      hasScrolledInitially = true
      requestAnimationFrame(() => scrollToBottom())
    }
  })

  // Auto-scroll for new messages only when user is near bottom
  createEffect((prevLength: number) => {
    const currentLength = currentMessages().length

    // Only scroll if new messages were added (not prepended) and user is near bottom
    if (currentLength > prevLength && isUserNearBottom && hasScrolledInitially) {
      requestAnimationFrame(() => scrollToBottom())
    }

    return currentLength
  }, 0)

  return (
    <div ref={feedRef} class="flex-1 min-w-0 overflow-y-auto overflow-x-hidden pt-2 pb-8">
      <div ref={sentinelRef} class="h-1" />

      <Show when={!hasMoreHistory() && currentMessages().length > 0}>
        <div class="py-4 text-center text-sm text-text-secondary">Beginning of conversation</div>
      </Show>

      <For each={groupedMessages()} fallback={<EmptyState />}>
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
