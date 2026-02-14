import type { Component, JSX } from "solid-js"

interface MessageRowFrameProps {
  compactMode: boolean
  isFirstInGroup: boolean
  isLastInGroup: boolean
  children: JSX.Element
}

const MessageRowFrame: Component<MessageRowFrameProps> = (props) => {
  const isSingleInGroup = () => props.isFirstInGroup && props.isLastInGroup

  return (
    <div
      class="rounded pl-4 hover:bg-surface-elevated/50 transition-colors group"
      classList={{
        "pt-2 pb-1": !props.compactMode && isSingleInGroup(),
        "pt-2 pb-0.5": !props.compactMode && props.isFirstInGroup && !props.isLastInGroup,
        "pt-1.5 pb-1": props.compactMode && isSingleInGroup(),
        "pt-1.5 pb-0.5": props.compactMode && props.isFirstInGroup && !props.isLastInGroup,
        "py-0.5": !props.isFirstInGroup
      }}
    >
      {props.children}
    </div>
  )
}

export default MessageRowFrame
