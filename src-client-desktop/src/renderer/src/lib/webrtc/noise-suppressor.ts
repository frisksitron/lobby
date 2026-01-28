import {
  loadRnnoise,
  loadSpeex,
  RnnoiseWorkletNode,
  SpeexWorkletNode
} from "@sapphi-red/web-noise-suppressor"
import rnnoiseWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url"
import rnnoiseWasmSimdPath from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url"
import rnnoiseWorkletPath from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url"
import speexWasmPath from "@sapphi-red/web-noise-suppressor/speex.wasm?url"
// Import paths with Vite URL transform
import speexWorkletPath from "@sapphi-red/web-noise-suppressor/speexWorklet.js?url"
import type { NoiseSuppressionAlgorithm } from "../../../../shared/types"
import { createLogger } from "../logger"
import { getSharedAudioContext } from "./audio-context"

const log = createLogger("AudioPipeline")

// ============================================================================
// Types
// ============================================================================

export interface AudioPipelineConfig {
  audioContext: AudioContext
  algorithm: NoiseSuppressionAlgorithm
  enabled: boolean
}

export interface AudioPipelineSettings {
  algorithm?: NoiseSuppressionAlgorithm
  enabled?: boolean
}

export interface AudioPipeline {
  process(input: MediaStream): MediaStream
  configure(settings: AudioPipelineSettings): void
  destroy(): void
}

interface WasmBinaries {
  speex: ArrayBuffer | null
  rnnoise: ArrayBuffer | null
}

// ============================================================================
// Module-level caches (loaded once, reused across sessions)
// ============================================================================

let wasmCache: WasmBinaries | null = null
let preloadPromise: Promise<WasmBinaries> | null = null
const registeredContexts = new WeakSet<AudioContext>()

/**
 * Preload WASM binaries and register worklets in the background.
 * Call this early (e.g., on server connection) so voice join is fast.
 */
export function preloadWasm(): void {
  // Load WASM and register worklets on shared context
  // Worklets can be registered on a suspended AudioContext
  getWasmBinaries()
    .then((wasm) => {
      const ctx = getSharedAudioContext()
      return registerWorklets(ctx, wasm)
    })
    .catch((err) => {
      log.warn("Preload failed:", err)
    })
}

function getWasmBinaries(): Promise<WasmBinaries> {
  if (wasmCache) {
    log.info("Using cached WASM binaries")
    return Promise.resolve(wasmCache)
  }

  // If load is already in progress, wait for it instead of starting a new one
  if (preloadPromise) {
    log.info("Waiting for WASM load to complete...")
    return preloadPromise
  }

  log.info("Loading WASM binaries...")

  // Create and store the promise immediately to prevent duplicate loads
  preloadPromise = (async () => {
    const wasm: WasmBinaries = { speex: null, rnnoise: null }

    // Load WASM binaries in parallel - if one fails, try to load the other
    const results = await Promise.allSettled([
      loadSpeex({ url: speexWasmPath }),
      loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseWasmSimdPath })
    ])

    if (results[0].status === "fulfilled") {
      wasm.speex = results[0].value
      log.info("Speex WASM loaded")
    } else {
      log.warn("Failed to load Speex WASM:", results[0].reason)
    }

    if (results[1].status === "fulfilled") {
      wasm.rnnoise = results[1].value
      log.info("RNNoise WASM loaded")
    } else {
      log.warn("Failed to load RNNoise WASM:", results[1].reason)
    }

    // Check if at least one WASM binary loaded
    if (!wasm.speex && !wasm.rnnoise) {
      preloadPromise = null
      throw new Error("Failed to load any WASM binaries")
    }

    wasmCache = wasm
    log.info("WASM binaries cached")
    return wasm
  })()

  return preloadPromise
}

// ============================================================================
// Worklet registration (per AudioContext)
// ============================================================================

async function registerWorklets(ctx: AudioContext, wasm: WasmBinaries): Promise<void> {
  // Skip if already registered on this context
  if (registeredContexts.has(ctx)) {
    log.info("Audio worklets already registered")
    return
  }

  log.info("Registering audio worklets...")

  const workletPromises: Promise<void>[] = []
  if (wasm.speex) {
    workletPromises.push(ctx.audioWorklet.addModule(speexWorkletPath))
  }
  if (wasm.rnnoise) {
    workletPromises.push(ctx.audioWorklet.addModule(rnnoiseWorkletPath))
  }

  await Promise.all(workletPromises)
  registeredContexts.add(ctx)
  log.info("Audio worklets registered")
}

// ============================================================================
// Factory function
// ============================================================================

export async function createAudioPipeline(config: AudioPipelineConfig): Promise<AudioPipeline> {
  const wasm = await getWasmBinaries()
  await registerWorklets(config.audioContext, wasm)

  // Closure state
  let sourceNode: MediaStreamAudioSourceNode | null = null
  let destinationNode: MediaStreamAudioDestinationNode | null = null
  let speexNode: SpeexWorkletNode | null = null
  let rnnoiseNode: RnnoiseWorkletNode | null = null
  let currentAlgorithm = config.algorithm
  let enabled = config.enabled
  const ctx = config.audioContext

  function getOrCreateNode(algorithm: NoiseSuppressionAlgorithm): AudioWorkletNode | null {
    try {
      if (algorithm === "speex") {
        if (!speexNode && wasm.speex) {
          log.info("Creating SpeexWorkletNode...")
          speexNode = new SpeexWorkletNode(ctx, {
            wasmBinary: wasm.speex,
            maxChannels: 1 // Mono for voice
          })
          log.info("SpeexWorkletNode created")
        }
        return speexNode
      }

      if (algorithm === "rnnoise") {
        if (!rnnoiseNode && wasm.rnnoise) {
          log.info("Creating RnnoiseWorkletNode...")
          rnnoiseNode = new RnnoiseWorkletNode(ctx, {
            wasmBinary: wasm.rnnoise,
            maxChannels: 1
          })
          log.info("RnnoiseWorkletNode created")
        }
        return rnnoiseNode
      }
    } catch (err) {
      log.error("Failed to create worklet node:", err)
      return null
    }

    return null
  }

  function disconnectAll(): void {
    try {
      sourceNode?.disconnect()
    } catch {
      // Ignore disconnect errors
    }
    try {
      speexNode?.disconnect()
    } catch {
      // Ignore disconnect errors
    }
    try {
      rnnoiseNode?.disconnect()
    } catch {
      // Ignore disconnect errors
    }
  }

  function rebuildGraph(): void {
    if (!sourceNode || !destinationNode) {
      log.info("rebuildGraph: no nodes yet, skipping")
      return
    }

    // Disconnect all existing connections
    disconnectAll()

    // Check if we should bypass (disabled or no algorithm)
    const shouldBypass = !enabled || currentAlgorithm === "none"

    if (shouldBypass) {
      // Bypass: connect source directly to destination
      sourceNode.connect(destinationNode)
      log.info("Graph rebuilt: bypass mode")
      return
    }

    // Try to connect through suppressor
    const activeNode = getOrCreateNode(currentAlgorithm)
    if (activeNode) {
      try {
        sourceNode.connect(activeNode)
        activeNode.connect(destinationNode)
        log.info(`Graph rebuilt: ${currentAlgorithm}`)
      } catch (err) {
        // If connection fails, fall back to bypass
        log.error("Failed to connect suppressor node:", err)
        disconnectAll()
        sourceNode.connect(destinationNode)
        log.info("Graph rebuilt: bypass (connection error)")
      }
    } else {
      // No active node available, use bypass
      sourceNode.connect(destinationNode)
      log.info("Graph rebuilt: bypass (no node available)")
    }
  }

  log.info("Pipeline created")

  return {
    process(input: MediaStream): MediaStream {
      try {
        // Create the audio graph nodes
        sourceNode = ctx.createMediaStreamSource(input)
        destinationNode = ctx.createMediaStreamDestination()
        log.info("Created audio graph nodes")

        // Build the initial graph based on current state
        rebuildGraph()

        // Return the destination stream
        return destinationNode.stream
      } catch (err) {
        log.error("Failed to create audio graph, returning raw stream:", err)
        return input
      }
    },

    configure(settings: AudioPipelineSettings): void {
      let needsRebuild = false

      if (settings.algorithm !== undefined && settings.algorithm !== currentAlgorithm) {
        currentAlgorithm = settings.algorithm
        needsRebuild = true
      }

      if (settings.enabled !== undefined && settings.enabled !== enabled) {
        enabled = settings.enabled
        needsRebuild = true
      }

      if (needsRebuild) {
        rebuildGraph()
        log.info(`Configured: enabled=${enabled}, algorithm=${currentAlgorithm}`)
      }
    },

    destroy(): void {
      log.info("Destroying...")
      disconnectAll()

      speexNode?.destroy()
      rnnoiseNode?.destroy()

      speexNode = null
      rnnoiseNode = null
      sourceNode = null
      destinationNode = null
    }
  }
}
