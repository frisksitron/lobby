import { A, useParams } from "@solidjs/router"
import { type Component, Show } from "solid-js"
import AboutSettings from "../components/settings/AboutSettings"
import AccountSettings from "../components/settings/AccountSettings"
import ServerSettings from "../components/settings/ServerSettings"
import ThemeSettings from "../components/settings/ThemeSettings"
import VoiceSettings from "../components/settings/VoiceSettings"
import { isSettingsTab, SETTINGS_TABS } from "../lib/constants/settings"
import PanelLayout from "../components/shared/PanelLayout"
import SidePanel from "../components/shared/SidePanel"
import Toggle from "../components/shared/Toggle"
import { useSettings } from "../stores/settings"

const SettingsView: Component = () => {
  const params = useParams()
  const { settings, updateSetting, isLoading } = useSettings()

  const activeTab = () => {
    if (isSettingsTab(params.tab)) return params.tab
    return isSettingsTab(settings().lastSettingsTab) ? settings().lastSettingsTab : "account"
  }

  return (
    <PanelLayout
      sidebar={
        <SidePanel>
          <div class="px-2 py-3">
            <h4 class="text-xs font-medium text-text-muted px-2 pb-1">Settings</h4>

            <nav class="space-y-0.5">
              {SETTINGS_TABS.map((tab) => (
                <A
                  href={`/settings/${tab.id}`}
                  onClick={() => {
                    if (settings().lastSettingsTab !== tab.id) {
                      void updateSetting("lastSettingsTab", tab.id)
                    }
                  }}
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
      }
      contentClass="overflow-y-auto"
    >
      <div class="max-w-2xl space-y-4 py-6 pb-32">
        <Show when={activeTab() === "account"}>
          <AccountSettings />
        </Show>
        <Show when={activeTab() === "server"}>
          <ServerSettings />
        </Show>
        <Show when={activeTab() === "voice"}>
          <VoiceSettings />
        </Show>
        <Show when={activeTab() === "appearance"}>
          <ThemeSettings />
          <section>
            <h3 class="text-xs font-semibold text-text-secondary uppercase mb-3">Chat</h3>
            <div class="flex items-center justify-between">
              <div>
                <label class="block text-sm font-medium text-text-secondary">Compact Mode</label>
                <span class="text-xs text-text-secondary">
                  Hide avatars and reduce spacing between messages
                </span>
              </div>
              <Toggle
                checked={settings().compactMode}
                onChange={(checked) => updateSetting("compactMode", checked)}
                disabled={isLoading()}
              />
            </div>
          </section>
        </Show>
        <Show when={activeTab() === "about"}>
          <AboutSettings />
        </Show>
      </div>
    </PanelLayout>
  )
}

export default SettingsView
