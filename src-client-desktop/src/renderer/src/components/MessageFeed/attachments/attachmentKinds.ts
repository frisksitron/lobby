import type { MessageAttachment } from "../../../../../shared/types"
import { connectionService } from "../../../lib/connection"

export type AttachmentViewerKind = "image" | "video" | "audio" | "pdf" | "none"

export function getAttachmentViewerKind(attachment: MessageAttachment): AttachmentViewerKind {
  const mimeType = attachment.mimeType.toLowerCase()
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType.startsWith("audio/")) return "audio"
  if (mimeType === "application/pdf") return "pdf"
  return "none"
}

export function getAttachmentKindLabel(viewerKind: AttachmentViewerKind): string {
  switch (viewerKind) {
    case "image":
      return "IMAGE"
    case "video":
      return "VIDEO"
    case "audio":
      return "AUDIO"
    case "pdf":
      return "PDF"
    default:
      return "FILE"
  }
}

function isLocalhostHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
}

export function toTrustedPdfSource(url: string): string | null {
  const serverUrl = connectionService.getServerUrl()
  if (!serverUrl) return null

  let serverOrigin: URL
  try {
    serverOrigin = new URL(serverUrl)
  } catch {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(url, serverOrigin.origin)
  } catch {
    return null
  }

  if (parsed.origin !== serverOrigin.origin) return null
  if (!parsed.pathname.startsWith("/media/")) return null

  const pathTail = parsed.pathname.slice("/media/".length)
  if (pathTail === "" || pathTail.includes("/")) return null

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
  if (parsed.protocol === "http:" && !isLocalhostHost(parsed.hostname)) return null

  return parsed.toString()
}

export function toDownloadURL(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin)
    parsed.searchParams.set("download", "1")
    return parsed.toString()
  } catch {
    const separator = url.includes("?") ? "&" : "?"
    return `${url}${separator}download=1`
  }
}
