import type { JSX } from "solid-js"

const SidePanel = (props: { children: JSX.Element }) => (
  <div class="w-60 bg-surface rounded-xl flex flex-col m-2 overflow-hidden ring-1 ring-white/8">
    {props.children}
  </div>
)

export default SidePanel
