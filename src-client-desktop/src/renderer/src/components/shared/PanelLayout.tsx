import type { JSX } from "solid-js"

const PanelLayout = (props: {
  sidebar: JSX.Element
  contentClass?: string
  children: JSX.Element
}) => (
  <>
    {props.sidebar}
    <main class={`flex-1 min-w-0 px-2 ${props.contentClass ?? ""}`}>{props.children}</main>
  </>
)

export default PanelLayout
