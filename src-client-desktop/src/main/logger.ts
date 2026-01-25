const IS_DEV = process.env.NODE_ENV !== "production"

export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export function createLogger(category: string): Logger {
  const prefix = `[${category}]`

  return {
    debug(...args: unknown[]): void {
      if (IS_DEV) console.log(prefix, ...args)
    },
    info(...args: unknown[]): void {
      if (IS_DEV) console.log(prefix, ...args)
    },
    warn(...args: unknown[]): void {
      console.warn(prefix, ...args)
    },
    error(...args: unknown[]): void {
      console.error(prefix, ...args)
    }
  }
}
