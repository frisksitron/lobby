const IS_DEV = import.meta.env.DEV

export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

function timestamp(): string {
  const now = new Date()
  const mins = now.getMinutes().toString().padStart(2, "0")
  const secs = now.getSeconds().toString().padStart(2, "0")
  const ms = now.getMilliseconds().toString().padStart(3, "0")
  return `${mins}:${secs}.${ms}`
}

export function createLogger(category: string): Logger {
  const prefix = `[${category}]`

  return {
    debug(...args: unknown[]): void {
      if (IS_DEV) console.log(timestamp(), prefix, ...args)
    },
    info(...args: unknown[]): void {
      if (IS_DEV) console.log(timestamp(), prefix, ...args)
    },
    warn(...args: unknown[]): void {
      console.warn(timestamp(), prefix, ...args)
    },
    error(...args: unknown[]): void {
      console.error(timestamp(), prefix, ...args)
    }
  }
}
