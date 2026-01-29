import type { Component } from "solid-js"

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

const Toggle: Component<ToggleProps> = (props) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      class={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed ${
        props.checked ? "bg-accent" : "bg-border"
      }`}
    >
      <span
        class={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
          props.checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  )
}

export default Toggle
