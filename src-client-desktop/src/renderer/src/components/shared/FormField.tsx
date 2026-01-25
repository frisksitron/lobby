import { type Component, type JSX, Show, splitProps } from "solid-js"

interface FormFieldProps {
  label: string
  children: JSX.Element
  error?: string
  hint?: string
}

const FormField: Component<FormFieldProps> = (props) => {
  return (
    <div>
      <label class="block text-sm font-medium text-text-secondary mb-1">{props.label}</label>
      {props.children}
      <Show when={props.error}>
        <p class="text-error text-sm mt-1">{props.error}</p>
      </Show>
      <Show when={props.hint && !props.error}>
        <span class="text-xs text-text-secondary mt-1 block">{props.hint}</span>
      </Show>
    </div>
  )
}

// Shared input class string for consistent styling
export const INPUT_CLASS =
  "w-full bg-surface-elevated border border-border rounded px-3 py-2 text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent"

export const INPUT_DISABLED_CLASS = `${INPUT_CLASS} disabled:opacity-50 disabled:cursor-not-allowed`

export const SELECT_CLASS = INPUT_CLASS

interface TextInputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
  fullWidth?: boolean
}

export const TextInput: Component<TextInputProps> = (props) => {
  const [local, inputProps] = splitProps(props, ["fullWidth", "class"])
  const baseClass =
    local.fullWidth === false ? INPUT_DISABLED_CLASS.replace("w-full ", "") : INPUT_DISABLED_CLASS
  return <input {...inputProps} class={`${baseClass} ${local.class || ""}`} />
}

export default FormField
