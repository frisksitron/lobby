import { type Accessor, createSignal, type Setter } from "solid-js"

export interface RetryConfig {
  delays: number[] // Delay in seconds for each retry tier (e.g., [2, 5, 10, 30])
  maxAttempts: number // Maximum number of retry attempts
  onAttempt?: (attempt: number, delay: number) => void
  onMaxRetries?: (attempt: number, maxAttempts: number) => void
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  delays: [2, 5, 10, 30],
  maxAttempts: 10
}

export class RetryStrategy {
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private countdownTimer: ReturnType<typeof setInterval> | null = null
  private config: RetryConfig
  private countdownValue: Accessor<number | null>
  private setCountdownValue: Setter<number | null>

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config }
    const [countdown, setCountdown] = createSignal<number | null>(null)
    this.countdownValue = countdown
    this.setCountdownValue = setCountdown
  }

  /**
   * Schedule a retry action with exponential backoff
   * @returns true if retry was scheduled, false if max attempts reached
   */
  schedule(action: () => Promise<boolean>): boolean {
    if (this.attempt >= this.config.maxAttempts) {
      return false
    }

    const delay = this.getNextDelay()
    this.startCountdown(delay)
    this.config.onAttempt?.(this.attempt, delay)

    this.timer = setTimeout(async () => {
      this.attempt++
      this.stopCountdown()
      const success = await action()
      if (!success) {
        const scheduled = this.schedule(action)
        if (!scheduled) {
          this.config.onMaxRetries?.(this.attempt, this.config.maxAttempts)
        }
      }
    }, delay * 1000)

    return true
  }

  /**
   * Cancel any pending retry
   */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.stopCountdown()
  }

  /**
   * Reset retry state (call on successful connection)
   */
  reset(): void {
    this.cancel()
    this.attempt = 0
  }

  /**
   * Get current attempt number (0-indexed)
   */
  getAttempt(): number {
    return this.attempt
  }

  /**
   * Get max attempts from config
   */
  getMaxAttempts(): number {
    return this.config.maxAttempts
  }

  /**
   * Get current countdown value (reactive signal)
   */
  getCountdown(): number | null {
    return this.countdownValue()
  }

  /**
   * Check if max retries have been reached
   */
  isMaxRetriesReached(): boolean {
    return this.attempt >= this.config.maxAttempts
  }

  private getNextDelay(): number {
    const delays = this.config.delays
    return delays[Math.min(this.attempt, delays.length - 1)]
  }

  private startCountdown(seconds: number): void {
    this.stopCountdown()
    this.setCountdownValue(seconds)

    this.countdownTimer = setInterval(() => {
      const current = this.countdownValue()
      if (current === null || current <= 1) {
        this.stopCountdown()
        return
      }
      this.setCountdownValue(current - 1)
    }, 1000)
  }

  private stopCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }
    this.setCountdownValue(null)
  }
}
