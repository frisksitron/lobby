import { createMicrophones, createSpeakers } from "@solid-primitives/devices"
import { type Component, For } from "solid-js"
import type { NoiseSuppressionAlgorithm } from "../../../../shared/types"
import { COMMUNICATIONS_DEVICE_PREFIX, DEFAULT_DEVICE_PREFIX } from "../../lib/constants/devices"
import { useSettings } from "../../stores/settings"
import Toggle from "../shared/Toggle"

const getPhysicalDevices = (devices: MediaDeviceInfo[]): MediaDeviceInfo[] =>
  devices.filter(
    (d) =>
      !d.label.startsWith(DEFAULT_DEVICE_PREFIX) &&
      !d.label.startsWith(COMMUNICATIONS_DEVICE_PREFIX)
  )

interface DeviceItemProps {
  label: string
  isSelected: boolean
  onSelect: () => void
}

const DeviceItem: Component<DeviceItemProps> = (props) => {
  return (
    <button
      type="button"
      onClick={() => props.onSelect()}
      class={`flex items-center gap-2 px-2 py-1.5 rounded w-full text-left transition-colors ${
        props.isSelected ? "bg-surface-elevated" : "hover:bg-surface-elevated/50"
      }`}
    >
      <span
        class={`text-sm flex-shrink-0 w-4 ${props.isSelected ? "text-accent" : "text-transparent"}`}
      >
        ✓
      </span>
      <span
        class={`text-sm break-words ${props.isSelected ? "text-text-primary" : "text-text-secondary"}`}
      >
        {props.label}
      </span>
    </button>
  )
}

interface NoiseSuppressionOption {
  id: NoiseSuppressionAlgorithm
  label: string
}

const NOISE_SUPPRESSION_OPTIONS: NoiseSuppressionOption[] = [
  { id: "rnnoise", label: "AI-based (RNNoise)" },
  { id: "speex", label: "Lightweight (Speex)" },
  { id: "none", label: "None" }
]

const VoiceSettings: Component = () => {
  const { settings, updateSetting, isLoading } = useSettings()

  const microphones = createMicrophones()
  const speakers = createSpeakers()

  const inputDevices = () => getPhysicalDevices(microphones())
  const outputDevices = () => getPhysicalDevices(speakers())

  return (
    <>
      <section>
        <h3 class="text-xs font-semibold text-text-secondary uppercase mb-3">Devices</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Input Device</label>
            <div class="border border-border rounded-lg p-1 space-y-0.5 bg-surface">
              <DeviceItem
                label="System default"
                isSelected={settings().inputDevice === "default"}
                onSelect={() => updateSetting("inputDevice", "default")}
              />
              <For each={inputDevices()}>
                {(device) => (
                  <DeviceItem
                    label={device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                    isSelected={settings().inputDevice === device.deviceId}
                    onSelect={() => updateSetting("inputDevice", device.deviceId)}
                  />
                )}
              </For>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Output Device</label>
            <div class="border border-border rounded-lg p-1 space-y-0.5 bg-surface">
              <DeviceItem
                label="System default"
                isSelected={settings().outputDevice === "default"}
                onSelect={() => updateSetting("outputDevice", "default")}
              />
              <For each={outputDevices()}>
                {(device) => (
                  <DeviceItem
                    label={device.label || `Speakers ${device.deviceId.slice(0, 8)}`}
                    isSelected={settings().outputDevice === device.deviceId}
                    onSelect={() => updateSetting("outputDevice", device.deviceId)}
                  />
                )}
              </For>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 class="text-xs font-semibold text-text-secondary uppercase mb-3">Processing</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">
              Noise Suppression
            </label>
            <div class="border border-border rounded-lg p-1 space-y-0.5 bg-surface">
              <For each={NOISE_SUPPRESSION_OPTIONS}>
                {(option) => (
                  <DeviceItem
                    label={option.label}
                    isSelected={settings().noiseSuppression === option.id}
                    onSelect={() => updateSetting("noiseSuppression", option.id)}
                  />
                )}
              </For>
            </div>
          </div>

          <div class="flex items-center justify-between">
            <div>
              <label class="block text-sm font-medium text-text-secondary">Echo Cancellation</label>
              <span class="text-xs text-text-secondary">Reduces echo from speakers</span>
            </div>
            <Toggle
              checked={settings().echoCancellation}
              onChange={(checked) => updateSetting("echoCancellation", checked)}
              disabled={isLoading()}
            />
          </div>

          <div class="flex items-center justify-between">
            <div>
              <label class="block text-sm font-medium text-text-secondary">Compressor</label>
              <span class="text-xs text-text-secondary">
                Limits loud sounds and boosts quiet ones
              </span>
            </div>
            <Toggle
              checked={settings().compressor}
              onChange={(checked) => updateSetting("compressor", checked)}
              disabled={isLoading()}
            />
          </div>
        </div>
      </section>
    </>
  )
}

export default VoiceSettings
