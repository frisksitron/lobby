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
  compressorEnabled: boolean
}

export interface AudioPipelineSettings {
  algorithm?: NoiseSuppressionAlgorithm
  enabled?: boolean
  compressorEnabled?: boolean
}

export interface AudioPipeline {
  getOutputStream(): MediaStream
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

export async function createAudioPipeline(
  inputStream: MediaStream,
  config: AudioPipelineConfig
): Promise<AudioPipeline> {
  const wasm = await getWasmBinaries()
  await registerWorklets(config.audioContext, wasm)

  const ctx = config.audioContext

  // Create nodes immediately - bound to this stream
  const sourceNode = ctx.createMediaStreamSource(inputStream)
  const destinationNode = ctx.createMediaStreamDestination()

  // Create compressor node - leveling compressor for gaming headsets
  // Handles wide dynamic range (quiet speech to screaming)
  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -40 // Catch quiet speech for makeup gain boost
  compressor.knee.value = 20 // Soft knee for natural sound
  compressor.ratio.value = 8 // Strong leveling without killing dynamics
  compressor.attack.value = 0.005 // 5ms - fast enough to catch screams
  compressor.release.value = 0.25 // 250ms - natural for speech rhythm

  // Closure state
  let speexNode: SpeexWorkletNode | null = null
  let rnnoiseNode: RnnoiseWorkletNode | null = null
  let currentAlgorithm = config.algorithm
  let enabled = config.enabled
  let compressorEnabled = config.compressorEnabled

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
    try {
      compressor?.disconnect()
    } catch {
      // Ignore disconnect errors
    }
  }

  function rebuildGraph(): void {
    // Disconnect all existing connections
    disconnectAll()

    // Check if we should bypass suppressor (disabled or no algorithm)
    const suppressorBypass = !enabled || currentAlgorithm === "none"
    const activeNode = suppressorBypass ? null : getOrCreateNode(currentAlgorithm)

    // Determine the graph structure based on enabled features
    // Graph: source → [suppressor] → [compressor] → destination
    try {
      if (!activeNode && !compressorEnabled) {
        // Full bypass: source → destination
        sourceNode.connect(destinationNode)
        log.info("Graph rebuilt: bypass mode")
      } else if (!activeNode && compressorEnabled) {
        // Compressor only: source → compressor → destination
        sourceNode.connect(compressor)
        compressor.connect(destinationNode)
        log.info("Graph rebuilt: compressor only")
      } else if (activeNode && !compressorEnabled) {
        // Suppressor only: source → suppressor → destination
        sourceNode.connect(activeNode)
        activeNode.connect(destinationNode)
        log.info(`Graph rebuilt: ${currentAlgorithm}`)
      } else if (activeNode && compressorEnabled) {
        // Both: source → suppressor → compressor → destination
        sourceNode.connect(activeNode)
        activeNode.connect(compressor)
        compressor.connect(destinationNode)
        log.info(`Graph rebuilt: ${currentAlgorithm} + compressor`)
      }
    } catch (err) {
      // If connection fails, fall back to bypass
      log.error("Failed to connect audio graph:", err)
      disconnectAll()
      sourceNode.connect(destinationNode)
      log.info("Graph rebuilt: bypass (connection error)")
    }
  }

  // Build initial graph
  rebuildGraph()

  log.info("Pipeline created")

  return {
    getOutputStream(): MediaStream {
      return destinationNode.stream
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

      if (
        settings.compressorEnabled !== undefined &&
        settings.compressorEnabled !== compressorEnabled
      ) {
        compressorEnabled = settings.compressorEnabled
        needsRebuild = true
      }

      if (needsRebuild) {
        rebuildGraph()
        log.info(
          `Configured: enabled=${enabled}, algorithm=${currentAlgorithm}, compressor=${compressorEnabled}`
        )
      }
    },

    destroy(): void {
      log.info("Destroying...")
      disconnectAll()

      speexNode?.destroy()
      rnnoiseNode?.destroy()

      speexNode = null
      rnnoiseNode = null
    }
  }
}
