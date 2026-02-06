import { A, useParams } from "@solidjs/router"
import { type Component, Show } from "solid-js"
import AboutSettings from "../components/settings/AboutSettings"
import AccountSettings from "../components/settings/AccountSettings"
import ThemeSettings from "../components/settings/ThemeSettings"
import VoiceSettings from "../components/settings/VoiceSettings"
import SidePanel from "../components/shared/SidePanel"

const TABS = [
  { id: "account", label: "Account" },
  { id: "voice", label: "Voice" },
  { id: "appearance", label: "Appearance" },
  { id: "about", label: "About" }
]

const SettingsView: Component = () => {
  const params = useParams()
  const activeTab = () => params.tab || "account"

  return (
    <>
      <SidePanel>
        <div class="px-2 py-3">
          <h4 class="text-xs font-medium text-text-muted px-2 pb-1">Settings</h4>

          <nav class="space-y-0.5">
            {TABS.map((tab) => (
              <A
                href={`/settings/${tab.id}`}
                class={`block px-2 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab() === tab.id
                    ? "bg-surface-elevated text-text-primary"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated/50"
                }`}
              >
                {tab.label}
              </A>
            ))}
          </nav>
        </div>
      </SidePanel>

      <div class="flex-1 overflow-y-auto py-6 pr-6 pl-4">
        <div class="max-w-2xl space-y-4">
          <Show when={activeTab() === "account"}>
            <AccountSettings />
          </Show>
          <Show when={activeTab() === "voice"}>
            <VoiceSettings />
          </Show>
          <Show when={activeTab() === "appearance"}>
            <ThemeSettings />
          </Show>
          <Show when={activeTab() === "about"}>
            <AboutSettings />
          </Show>
        </div>
      </div>
    </>
  )
}

export default SettingsView
