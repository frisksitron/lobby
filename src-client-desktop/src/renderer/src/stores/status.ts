import { createSignal } from "solid-js"

export type StatusType = "voice" | "connection" | "message" | "device"

export interface ActiveStatus {
  id: string
  type: StatusType
  code: string // e.g., "mic_permission_denied", "voice_cooldown"
  message: string
  expiresAt?: number // For transient issues - auto-remove when expired
}

const [activeStatuses, setActiveStatuses] = createSignal<ActiveStatus[]>([])

// Cleanup interval for expired statuses
let cleanupInterval: ReturnType<typeof setInterval> | null = null

function startCleanupTimer(): void {
  if (cleanupInterval) return
  cleanupInterval = setInterval(() => {
    clearExpired()
  }, 1000)
}

function stopCleanupTimer(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
  }
}

/**
 * Add or update a status. If a status with the same code exists, it will be updated.
 */
export function setStatus(status: Omit<ActiveStatus, "id">): void {
  const id = `${status.type}-${status.code}`

  setActiveStatuses((prev) => {
    const existing = prev.find((s) => s.code === status.code)
    if (existing) {
      // Update existing status
      return prev.map((s) => (s.code === status.code ? { ...status, id } : s))
    }
    // Add new status
    return [...prev, { ...status, id }]
  })

  // Start cleanup timer if we have expiring statuses
  if (status.expiresAt) {
    startCleanupTimer()
  }
}

/**
 * Remove a status by code
 */
export function clearStatus(code: string): void {
  setActiveStatuses((prev) => prev.filter((s) => s.code !== code))

  // Stop cleanup timer if no more expiring statuses
  const hasExpiring = activeStatuses().some((s) => s.expiresAt)
  if (!hasExpiring) {
    stopCleanupTimer()
  }
}

/**
 * Remove all expired statuses
 */
export function clearExpired(): void {
  const now = Date.now()
  setActiveStatuses((prev) => prev.filter((s) => !s.expiresAt || s.expiresAt > now))

  // Stop cleanup timer if no more expiring statuses
  const hasExpiring = activeStatuses().some((s) => s.expiresAt)
  if (!hasExpiring) {
    stopCleanupTimer()
  }
}

/**
 * Clear all statuses
 */
export function clearAllStatuses(): void {
  setActiveStatuses([])
  stopCleanupTimer()
}

/**
 * Check if there are any active issues
 */
export function hasActiveIssues(): boolean {
  return activeStatuses().length > 0
}

/**
 * Get remaining time in seconds for a transient status
 */
export function getRemainingSeconds(status: ActiveStatus): number | null {
  if (!status.expiresAt) return null
  const remaining = Math.ceil((status.expiresAt - Date.now()) / 1000)
  return remaining > 0 ? remaining : 0
}

export function useStatus() {
  return {
    activeStatuses,
    hasActiveIssues: () => activeStatuses().length > 0,
    setStatus,
    clearStatus,
    clearExpired,
    clearAllStatuses,
    getRemainingSeconds
  }
}
