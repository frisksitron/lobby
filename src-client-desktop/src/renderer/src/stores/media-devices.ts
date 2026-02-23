import { createDevices } from "@solid-primitives/devices"
import { createEffect, createMemo, createRoot, createSignal, on } from "solid-js"
import { COMMUNICATIONS_DEVICE_PREFIX, DEFAULT_DEVICE_PREFIX } from "../lib/constants/devices"
import { ERROR_CODES, getErrorMessage } from "../lib/errors/user-messages"
import { useSettings } from "./settings"
import { reportIssue, resolveIssue } from "./status"

const getPhysicalDevices = (devices: MediaDeviceInfo[]): MediaDeviceInfo[] =>
  devices.filter(
    (d) =>
      !d.label.startsWith(DEFAULT_DEVICE_PREFIX) &&
      !d.label.startsWith(COMMUNICATIONS_DEVICE_PREFIX)
  )

const mediaDevicesStore = createRoot(() => {
  const { settings } = useSettings()
  const devices = createDevices()
  const microphones = createMemo(() => devices().filter((device) => device.kind === "audioinput"))
  const speakers = createMemo(() => devices().filter((device) => device.kind === "audiooutput"))
  const inputDevices = createMemo(() => getPhysicalDevices(microphones()))
  const outputDevices = createMemo(() => getPhysicalDevices(speakers()))
  const [devicesInitialized, setDevicesInitialized] = createSignal(false)

  createEffect(on(devices, () => setDevicesInitialized(true), { defer: true }))

  createEffect(
    on(
      [devicesInitialized, inputDevices, () => settings().inputDevice],
      ([initialized, availableInputs, selectedInputDevice]) => {
        if (!initialized) {
          return
        }

        if (availableInputs.length === 0) {
          reportIssue({
            type: "device",
            code: ERROR_CODES.NO_DEVICE,
            message: getErrorMessage(ERROR_CODES.NO_DEVICE)
          })
          resolveIssue(ERROR_CODES.SELECTED_INPUT_MISSING)
          return
        }

        resolveIssue(ERROR_CODES.NO_DEVICE)

        const selectedInputMissing =
          selectedInputDevice !== "default" &&
          selectedInputDevice !== "" &&
          !availableInputs.some((device) => device.deviceId === selectedInputDevice)

        if (selectedInputMissing) {
          reportIssue({
            type: "device",
            code: ERROR_CODES.SELECTED_INPUT_MISSING,
            message: getErrorMessage(ERROR_CODES.SELECTED_INPUT_MISSING)
          })
        } else {
          resolveIssue(ERROR_CODES.SELECTED_INPUT_MISSING)
        }
      },
      { defer: true }
    )
  )

  return {
    inputDevices,
    outputDevices
  }
})

export function useMediaDevices() {
  return mediaDevicesStore
}
