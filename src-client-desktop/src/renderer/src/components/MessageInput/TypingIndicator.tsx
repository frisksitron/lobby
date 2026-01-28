import { type Component, createMemo } from "solid-js"
import { useSession } from "../../stores/core"

const TypingIndicator: Component = () => {
  const { typingUsers } = useSession()

  const typingNames = createMemo(() => {
    return typingUsers().map((tu) => tu.username)
  })

  const isActive = () => typingNames().length > 0

  // Format the typing message
  const typingText = createMemo(() => {
    const names = typingNames()
    if (names.length === 0) return ""
    if (names.length === 1) return `${names[0]} is typing`
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing`
    if (names.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]} are typing`
    return `${names[0]}, ${names[1]}, and ${names.length - 2} others are typing`
  })

  return (
    <div
      class="h-6 px-4 text-sm text-text-secondary flex items-center gap-2 transition-opacity"
      classList={{ "opacity-0": !isActive() }}
    >
      <span class="flex gap-0.5">
        <span
          class="w-1.5 h-1.5 bg-text-secondary rounded-full animate-bounce"
          style="animation-delay: 0ms"
        />
        <span
          class="w-1.5 h-1.5 bg-text-secondary rounded-full animate-bounce"
          style="animation-delay: 150ms"
        />
        <span
          class="w-1.5 h-1.5 bg-text-secondary rounded-full animate-bounce"
          style="animation-delay: 300ms"
        />
      </span>
      <span>{typingText()}</span>
    </div>
  )
}

export default TypingIndicator
