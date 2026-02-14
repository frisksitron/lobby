export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function toValidMaxBytes(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return value
}

export function formatUploadTooLargeMessage(maxBytes: number | null, noun: string): string {
  const message = `${noun} exceeds max upload size`
  if (!maxBytes) return message
  return `${message} (${formatBytes(maxBytes)})`
}
