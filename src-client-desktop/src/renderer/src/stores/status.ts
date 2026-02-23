import { createMemo, createSignal, untrack } from "solid-js"

export type StatusType = "voice" | "connection" | "message" | "device"

export interface ActiveStatus {
  id: string
  type: StatusType
  code: string // e.g., "mic_permission_denied", "voice_cooldown"
  message: string
  expiresAt?: number // For transient issues - auto-remove when expired
}

type StatusInput = Omit<ActiveStatus, "id">

const [activeStatuses, setActiveStatuses] = createSignal<ActiveStatus[]>([])

let cleanupTimeout: ReturnType<typeof setTimeout> | null = null

function toStatusId(status: StatusInput): string {
  return `${status.type}-${status.code}`
}

function stopCleanupTimer(): void {
  if (cleanupTimeout) {
    clearTimeout(cleanupTimeout)
    cleanupTimeout = null
  }
}

function getNextExpiry(statuses: ActiveStatus[]): number | null {
  const now = Date.now()
  let nextExpiry: number | null = null

  for (const status of statuses) {
    if (!status.expiresAt) continue
    if (status.expiresAt <= now) {
      return now
    }

    if (nextExpiry === null || status.expiresAt < nextExpiry) {
      nextExpiry = status.expiresAt
    }
  }

  return nextExpiry
}

function scheduleCleanupTimer(): void {
  stopCleanupTimer()

  const nextExpiry = getNextExpiry(untrack(activeStatuses))
  if (nextExpiry === null) return

  const delay = Math.max(0, nextExpiry - Date.now()) + 5
  cleanupTimeout = setTimeout(() => {
    cleanupTimeout = null
    clearExpired()
  }, delay)
}

/**
 * Add or update a status. If a status with the same code exists, it will be updated.
 */
export function reportIssue(status: StatusInput): void {
  const nextStatus: ActiveStatus = {
    ...status,
    id: toStatusId(status)
  }

  setActiveStatuses((prev) => {
    const index = prev.findIndex((s) => s.code === nextStatus.code)
    if (index === -1) {
      return [...prev, nextStatus]
    }

    const existing = prev[index]
    if (
      existing.type === nextStatus.type &&
      existing.message === nextStatus.message &&
      existing.expiresAt === nextStatus.expiresAt
    ) {
      return prev
    }

    const updated = prev.slice()
    updated[index] = nextStatus
    return updated
  })

  scheduleCleanupTimer()
}

/**
 * Remove a status by code
 */
export function resolveIssue(code: string): void {
  setActiveStatuses((prev) => {
    const index = prev.findIndex((s) => s.code === code)
    if (index === -1) {
      return prev
    }

    const updated = prev.slice()
    updated.splice(index, 1)
    return updated
  })

  scheduleCleanupTimer()
}

/**
 * Remove all expired statuses
 */
export function clearExpired(): void {
  const now = Date.now()
  setActiveStatuses((prev) => {
    let changed = false
    const filtered = prev.filter((s) => {
      const keep = !s.expiresAt || s.expiresAt > now
      if (!keep) {
        changed = true
      }
      return keep
    })
    return changed ? filtered : prev
  })

  scheduleCleanupTimer()
}

/**
 * Clear all statuses
 */
export function clearAllStatuses(): void {
  setActiveStatuses([])
  stopCleanupTimer()
}

export function expiresAtFromRetryAfter(
  retryAfter: number | null | undefined,
  fallbackMs: number
): number {
  const now = Date.now()
  if (typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > now) {
    return retryAfter
  }
  return now + fallbackMs
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
  const hasIssues = createMemo(() => activeStatuses().length > 0)

  return {
    activeStatuses,
    hasActiveIssues: hasIssues,
    reportIssue,
    resolveIssue,
    clearExpired,
    clearAllStatuses,
    getRemainingSeconds
  }
}
