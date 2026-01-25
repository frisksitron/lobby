import { type Component, createEffect, For, on } from "solid-js"
import { COMMUNICATIONS_DEVICE_PREFIX, DEFAULT_DEVICE_PREFIX } from "../../lib/constants/devices"
import { webrtcManager } from "../../lib/webrtc"
import { useSettings } from "../../stores/settings"
import ThemeSettings from "../settings/ThemeSettings"
import Button from "../shared/Button"
import DialogFooter from "../shared/DialogFooter"
import FormField, { SELECT_CLASS } from "../shared/FormField"
import Modal from "../shared/Modal"

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

// Filter out Windows virtual devices (Default/Communications) and get physical devices only
const getPhysicalDevices = (devices: MediaDeviceInfo[]): MediaDeviceInfo[] =>
  devices.filter(
    (d) =>
      !d.label.startsWith(DEFAULT_DEVICE_PREFIX) &&
      !d.label.startsWith(COMMUNICATIONS_DEVICE_PREFIX)
  )

// Extract the default device name from the "Default - X" virtual device
const getDefaultDeviceName = (devices: MediaDeviceInfo[]): string | null => {
  const defaultDevice = devices.find((d) => d.label.startsWith(DEFAULT_DEVICE_PREFIX))
  return defaultDevice ? defaultDevice.label.replace(DEFAULT_DEVICE_PREFIX, "") : null
}

const SettingsModal: Component<SettingsModalProps> = (props) => {
  const { settings, loadSettings, updateSetting, isLoading, audioDevices, loadAudioDevices } =
    useSettings()

  // Load settings and audio devices when modal opens
  createEffect(() => {
    if (props.isOpen) {
      loadSettings()
      loadAudioDevices()
    }
  })

  // Update noise suppressor in real-time when settings change
  createEffect(
    on(
      () => settings().noiseSuppression,
      (algorithm) => {
        // Only update if webrtc is active (will be no-op if not in voice)
        webrtcManager.updateNoiseSuppressionSettings(algorithm !== "none", algorithm)
      },
      { defer: true } // Don't run on initial mount, only on changes
    )
  )

  // Get filtered device lists and default names
  const inputDevices = () => getPhysicalDevices(audioDevices().inputDevices)
  const outputDevices = () => getPhysicalDevices(audioDevices().outputDevices)
  const defaultInputName = () => getDefaultDeviceName(audioDevices().inputDevices)
  const defaultOutputName = () => getDefaultDeviceName(audioDevices().outputDevices)

  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} title="Settings">
      <div class="space-y-6">
        <ThemeSettings />

        <section>
          <h3 class="text-sm font-semibold text-text-primary mb-3">Voice Settings</h3>

          <div class="space-y-4">
            <FormField label="Input Device">
              <select
                onChange={(e) => updateSetting("inputDevice", e.currentTarget.value)}
                disabled={isLoading()}
                class={`${SELECT_CLASS} disabled:opacity-50`}
              >
                <option value="default" selected={settings().inputDevice === "default"}>
                  {defaultInputName() ? `Default (${defaultInputName()})` : "Default"}
                </option>
                <For each={inputDevices()}>
                  {(device) => (
                    <option
                      value={device.deviceId}
                      selected={settings().inputDevice === device.deviceId}
                    >
                      {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                    </option>
                  )}
                </For>
              </select>
            </FormField>

            <FormField label="Output Device">
              <select
                onChange={(e) => updateSetting("outputDevice", e.currentTarget.value)}
                disabled={isLoading()}
                class={`${SELECT_CLASS} disabled:opacity-50`}
              >
                <option value="default" selected={settings().outputDevice === "default"}>
                  {defaultOutputName() ? `Default (${defaultOutputName()})` : "Default"}
                </option>
                <For each={outputDevices()}>
                  {(device) => (
                    <option
                      value={device.deviceId}
                      selected={settings().outputDevice === device.deviceId}
                    >
                      {device.label || `Speakers ${device.deviceId.slice(0, 8)}`}
                    </option>
                  )}
                </For>
              </select>
            </FormField>

            <FormField
              label="Noise Suppression"
              hint="Removes background noise from your microphone"
            >
              <select
                value={settings().noiseSuppression}
                onChange={(e) =>
                  updateSetting(
                    "noiseSuppression",
                    e.currentTarget.value as "speex" | "rnnoise" | "none"
                  )
                }
                disabled={isLoading()}
                class={`${SELECT_CLASS} disabled:opacity-50`}
              >
                <option value="rnnoise">RNNoise (AI-based)</option>
                <option value="speex">Speex (lightweight)</option>
                <option value="none">None</option>
              </select>
            </FormField>
          </div>
        </section>

        <DialogFooter>
          <Button variant="primary" onClick={props.onClose}>
            Done
          </Button>
        </DialogFooter>

        <div class="pt-4 border-t border-border text-xs text-text-secondary">
          <p>Lobby v{__APP_VERSION__}</p>
          <p class="mt-1">
            Electron {window.electron.process.versions.electron} · Chrome{" "}
            {window.electron.process.versions.chrome} · Node {window.electron.process.versions.node}
          </p>
        </div>
      </div>
    </Modal>
  )
}

export default SettingsModal
