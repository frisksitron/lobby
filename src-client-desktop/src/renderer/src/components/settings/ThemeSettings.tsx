import { type Component, For } from "solid-js"
import type { Theme } from "../../../../shared/types"
import { useTheme } from "../../stores/theme"

interface ThemePreviewProps {
  theme: Theme
  isSelected: boolean
  onSelect: () => void
}

const ThemePreview: Component<ThemePreviewProps> = (props) => {
  return (
    <button
      type="button"
      onClick={() => props.onSelect()}
      class={`flex items-center gap-3 p-3 rounded-lg border-2 transition-colors w-full ${
        props.isSelected
          ? "border-accent bg-surface-elevated"
          : "border-border bg-surface hover:border-text-secondary"
      }`}
    >
      {/* Mini app preview */}
      <div
        class="w-14 h-10 rounded overflow-hidden flex shrink-0"
        style={{ "background-color": props.theme.colors.background }}
      >
        {/* Sidebar */}
        <div class="w-4 h-full" style={{ "background-color": props.theme.colors.surface }} />
        {/* Main content area */}
        <div class="flex-1 p-1 flex flex-col justify-end gap-0.5">
          {/* Mock messages */}
          <div
            class="h-1.5 w-full rounded-sm opacity-40"
            style={{ "background-color": props.theme.colors.textSecondary }}
          />
          <div
            class="h-1.5 w-3/4 rounded-sm opacity-40"
            style={{ "background-color": props.theme.colors.textSecondary }}
          />
          {/* Input bar */}
          <div
            class="h-2 w-full rounded-sm mt-0.5"
            style={{ "background-color": props.theme.colors.surfaceElevated }}
          />
        </div>
      </div>

      {/* Accent color dot */}
      <div
        class="w-3 h-3 rounded-full shrink-0"
        style={{ "background-color": props.theme.colors.accent }}
      />

      {/* Theme name */}
      <span class="text-text-primary font-medium">{props.theme.name}</span>

      {/* Selected indicator */}
      {props.isSelected && <span class="ml-auto text-xs text-accent font-medium">Selected</span>}
    </button>
  )
}

const ThemeSettings: Component = () => {
  const { currentTheme, changeTheme, getAvailableThemes } = useTheme()

  const handleThemeSelect = (themeId: string): void => {
    changeTheme(themeId)
  }

  return (
    <section>
      <h3 class="text-sm font-semibold text-text-primary mb-3">Appearance</h3>
      <div class="space-y-2">
        <For each={getAvailableThemes()}>
          {(theme) => (
            <ThemePreview
              theme={theme}
              isSelected={currentTheme().id === theme.id}
              onSelect={() => handleThemeSelect(theme.id)}
            />
          )}
        </For>
      </div>
    </section>
  )
}

export default ThemeSettings
