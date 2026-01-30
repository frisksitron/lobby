import { type Component, For } from "solid-js"

interface Tab {
  id: string
  label: string
}

interface TabsProps {
  tabs: Tab[]
  activeTab: string
  onTabChange: (id: string) => void
}

const Tabs: Component<TabsProps> = (props) => {
  return (
    <div class="flex gap-2">
      <For each={props.tabs}>
        {(tab, index) => (
          <button
            type="button"
            onClick={() => props.onTabChange(tab.id)}
            class={`py-2 pr-4 text-sm font-medium transition-colors relative cursor-pointer ${
              index() === 0 ? "pl-4" : "pl-2"
            } ${
              props.activeTab === tab.id
                ? "text-accent"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {tab.label}
            {props.activeTab === tab.id && (
              <div
                class={`absolute bottom-0 right-0 h-0.5 bg-accent ${index() === 0 ? "left-4" : "left-2"}`}
              />
            )}
          </button>
        )}
      </For>
    </div>
  )
}

export default Tabs
