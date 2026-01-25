import type { Component, JSX } from "solid-js"

interface DialogFooterProps {
  children: JSX.Element
  borderTop?: boolean
}

const DialogFooter: Component<DialogFooterProps> = (props) => {
  const borderClass = props.borderTop !== false ? "border-t border-border" : ""
  return <div class={`flex justify-end gap-2 pt-4 ${borderClass}`}>{props.children}</div>
}

export default DialogFooter
