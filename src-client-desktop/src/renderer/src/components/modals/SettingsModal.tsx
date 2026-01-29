import { type Component, createSignal, Show } from "solid-js"
import AboutSettings from "../settings/AboutSettings"
import ThemeSettings from "../settings/ThemeSettings"
import VoiceSettings from "../settings/VoiceSettings"
import Button from "../shared/Button"
import Modal from "../shared/Modal"
import Tabs from "../shared/Tabs"

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

const TABS = [
  { id: "voice", label: "Voice" },
  { id: "appearance", label: "Appearance" },
  { id: "about", label: "About" }
]

const SettingsModal: Component<SettingsModalProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal("voice")

  const header = <Tabs tabs={TABS} activeTab={activeTab()} onTabChange={setActiveTab} />

  const footer = (
    <div class="flex justify-end">
      <Button variant="primary" onClick={props.onClose}>
        Done
      </Button>
    </div>
  )

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="Settings"
      headerContent={header}
      footer={footer}
    >
      <div class="space-y-4 pb-12 pr-4">
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
    </Modal>
  )
}

export default SettingsModal
