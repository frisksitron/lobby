import type { Component, JSX } from "solid-js"

interface ButtonProps {
  type?: "button" | "submit" | "reset"
  variant?: "primary" | "secondary" | "ghost" | "danger"
  size?: "sm" | "md" | "lg"
  disabled?: boolean
  onClick?: () => void
  children: JSX.Element
  class?: string
}

const variantClasses = {
  primary: "bg-accent text-white hover:bg-accent/90",
  secondary: "bg-surface-elevated text-text-primary hover:bg-border",
  ghost: "bg-transparent text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
  danger: "bg-error text-white hover:bg-error/90"
}

const sizeClasses = {
  sm: "px-2 py-1 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base"
}

const Button: Component<ButtonProps> = (props) => {
  const variant = () => props.variant || "primary"
  const size = () => props.size || "md"

  return (
    <button
      type={props.type || "button"}
      class={`inline-flex items-center justify-center rounded font-medium transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant()]} ${sizeClasses[size()]} ${props.class || ""}`}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

export default Button
