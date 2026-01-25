import { type Component, type JSX, Show } from "solid-js"

interface ButtonWithIconProps {
  icon: JSX.Element
  label?: string
  variant?: "ghost" | "secondary" | "danger"
  size?: "sm" | "md" | "lg"
  round?: boolean
  disabled?: boolean
  onClick?: (e: MouseEvent) => void
  class?: string
  title?: string
}

const variantClasses = {
  ghost: "text-text-secondary hover:text-text-primary hover:bg-surface-elevated",
  secondary: "bg-surface-elevated text-text-primary hover:bg-border",
  danger: "bg-error text-white hover:bg-error/90"
}

// Padding for icon-only buttons
const iconOnlySizeClasses = {
  sm: "p-1",
  md: "p-2",
  lg: "p-3"
}

// Padding for icon + label buttons
const withLabelSizeClasses = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-2 text-sm",
  lg: "px-4 py-3 text-base"
}

const ButtonWithIcon: Component<ButtonWithIconProps> = (props) => {
  const variant = () => props.variant || "ghost"
  const size = () => props.size || "md"
  const hasLabel = () => !!props.label
  const sizeClass = () => (hasLabel() ? withLabelSizeClasses[size()] : iconOnlySizeClasses[size()])
  const roundClass = () => (props.round ? "rounded-full" : "rounded")

  return (
    <button
      type="button"
      class={`flex items-center gap-2 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant()]} ${sizeClass()} ${roundClass()} ${props.class || ""}`}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title || props.label}
    >
      {props.icon}
      <Show when={props.label}>
        <span>{props.label}</span>
      </Show>
    </button>
  )
}

export default ButtonWithIcon
