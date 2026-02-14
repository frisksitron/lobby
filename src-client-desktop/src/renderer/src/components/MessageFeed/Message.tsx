import { type Component, createMemo, Show } from "solid-js"
import type { Message as MessageType } from "../../../../shared/types"
import { useSettings } from "../../stores/settings"
import { useUsers } from "../../stores/users"
import MessageRowCompact from "./MessageRowCompact"
import MessageRowCozy from "./MessageRowCozy"
import MessageRowFrame from "./MessageRowFrame"

interface MessageProps {
  message: MessageType
  isFirstInGroup?: boolean
  isLastInGroup?: boolean
}

const Message: Component<MessageProps> = (props) => {
  const { settings } = useSettings()
  const { getUserById } = useUsers()

  const compactMode = createMemo(() => settings().compactMode)
  const isFirstInGroup = createMemo(() => props.isFirstInGroup ?? true)
  const isLastInGroup = createMemo(() => props.isLastInGroup ?? true)
  const author = createMemo(() => getUserById(props.message.authorId))
  const authorName = createMemo(() => author()?.username || props.message.authorName)
  const authorAvatarUrl = createMemo(() => author()?.avatarUrl ?? props.message.authorAvatarUrl)
  const authorStatus = createMemo(() => author()?.status)

  return (
    <MessageRowFrame
      compactMode={compactMode()}
      isFirstInGroup={isFirstInGroup()}
      isLastInGroup={isLastInGroup()}
    >
      <Show
        when={compactMode()}
        fallback={
          <MessageRowCozy
            message={props.message}
            isFirstInGroup={isFirstInGroup()}
            authorName={authorName()}
            authorAvatarUrl={authorAvatarUrl()}
            authorStatus={authorStatus()}
          />
        }
      >
        <MessageRowCompact
          message={props.message}
          isFirstInGroup={isFirstInGroup()}
          authorName={authorName()}
        />
      </Show>
    </MessageRowFrame>
  )
}

export default Message
