import { createSignal } from "solid-js"

export interface VoiceStats {
  // Audio stats
  codec: string | null
  clockRate: number | null
  bitrateIn: number | null
  bitrateOut: number | null
  rtt: number | null
  jitter: number | null
  packetLossPercent: number | null
  packetsSent: number
  packetsReceived: number
  packetsLost: number
  // Video stats (screenshare)
  videoBitrateIn: number | null
  videoBitrateOut: number | null
  videoCodec: string | null
}

const [stats, setStats] = createSignal<VoiceStats | null>(null)
const [isCollecting, setIsCollecting] = createSignal(false)

let intervalId: ReturnType<typeof setInterval> | null = null
let prevBytesReceived = 0
let prevBytesSent = 0
let prevVideoBytesReceived = 0
let prevVideoBytesSent = 0
let prevTimestamp = 0

function createEmptyStats(): VoiceStats {
  return {
    codec: null,
    clockRate: null,
    bitrateIn: null,
    bitrateOut: null,
    rtt: null,
    jitter: null,
    packetLossPercent: null,
    packetsSent: 0,
    packetsReceived: 0,
    packetsLost: 0,
    videoBitrateIn: null,
    videoBitrateOut: null,
    videoCodec: null
  }
}

async function collectStats(pc: RTCPeerConnection): Promise<void> {
  const report = await pc.getStats()
  const newStats = createEmptyStats()

  let bytesReceived = 0
  let bytesSent = 0
  let videoBytesReceived = 0
  let videoBytesSent = 0
  let hasVideoInbound = false
  let hasVideoOutbound = false
  const now = performance.now()

  report.forEach((stat) => {
    // Audio stats
    if (stat.type === "inbound-rtp" && stat.kind === "audio") {
      newStats.jitter = stat.jitter !== undefined ? stat.jitter * 1000 : null
      newStats.packetsReceived = stat.packetsReceived ?? 0
      newStats.packetsLost = stat.packetsLost ?? 0
      bytesReceived = stat.bytesReceived ?? 0

      const totalPackets = newStats.packetsReceived + newStats.packetsLost
      if (totalPackets > 0) {
        newStats.packetLossPercent = (newStats.packetsLost / totalPackets) * 100
      }
    }

    if (stat.type === "outbound-rtp" && stat.kind === "audio") {
      newStats.packetsSent = stat.packetsSent ?? 0
      bytesSent = stat.bytesSent ?? 0
    }

    // Video stats (screenshare)
    if (stat.type === "inbound-rtp" && stat.kind === "video") {
      hasVideoInbound = true
      videoBytesReceived = stat.bytesReceived ?? 0
    }

    if (stat.type === "outbound-rtp" && stat.kind === "video") {
      hasVideoOutbound = true
      videoBytesSent = stat.bytesSent ?? 0
    }

    if (stat.type === "candidate-pair" && stat.state === "succeeded") {
      newStats.rtt =
        stat.currentRoundTripTime !== undefined ? stat.currentRoundTripTime * 1000 : null
    }

    // Codec detection
    if (stat.type === "codec" && stat.mimeType?.startsWith("audio/")) {
      const codecName = stat.mimeType.replace("audio/", "")
      newStats.codec = codecName.charAt(0).toUpperCase() + codecName.slice(1)
      newStats.clockRate = stat.clockRate ?? null
    }

    if (stat.type === "codec" && stat.mimeType?.startsWith("video/")) {
      const codecName = stat.mimeType.replace("video/", "")
      newStats.videoCodec = codecName.toUpperCase()
    }
  })

  // Calculate bitrates from deltas
  if (prevTimestamp > 0) {
    const timeDelta = (now - prevTimestamp) / 1000
    if (timeDelta > 0) {
      // Audio bitrates
      const bytesReceivedDelta = bytesReceived - prevBytesReceived
      const bytesSentDelta = bytesSent - prevBytesSent
      newStats.bitrateIn = bytesReceivedDelta > 0 ? (bytesReceivedDelta * 8) / timeDelta / 1000 : 0
      newStats.bitrateOut = bytesSentDelta > 0 ? (bytesSentDelta * 8) / timeDelta / 1000 : 0

      // Video bitrates - use 0 when active but no delta, null when not active
      const videoBytesReceivedDelta = videoBytesReceived - prevVideoBytesReceived
      const videoBytesSentDelta = videoBytesSent - prevVideoBytesSent
      newStats.videoBitrateIn = hasVideoInbound
        ? (videoBytesReceivedDelta * 8) / timeDelta / 1000
        : null
      newStats.videoBitrateOut = hasVideoOutbound
        ? (videoBytesSentDelta * 8) / timeDelta / 1000
        : null
    }
  }

  prevBytesReceived = bytesReceived
  prevBytesSent = bytesSent
  prevVideoBytesReceived = videoBytesReceived
  prevVideoBytesSent = videoBytesSent
  prevTimestamp = now

  setStats(newStats)
}

export function startStatsCollection(pc: RTCPeerConnection): void {
  if (intervalId) return

  // Reset state
  prevBytesReceived = 0
  prevBytesSent = 0
  prevVideoBytesReceived = 0
  prevVideoBytesSent = 0
  prevTimestamp = 0
  setStats(createEmptyStats())
  setIsCollecting(true)

  // Initial collection
  collectStats(pc)

  // Poll every 1 second
  intervalId = setInterval(() => {
    collectStats(pc)
  }, 1000)
}

export function stopStatsCollection(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  setIsCollecting(false)
  setStats(null)
  prevBytesReceived = 0
  prevBytesSent = 0
  prevVideoBytesReceived = 0
  prevVideoBytesSent = 0
  prevTimestamp = 0
}

export function useVoiceStats() {
  return {
    stats,
    isCollecting
  }
}
