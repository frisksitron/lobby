import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js"

/**
 * Creates a deferred signal that only becomes true after the source
 * has been true for at least `delayMs` milliseconds.
 * Immediately returns false when source becomes false.
 */
export function createDeferred(source: Accessor<boolean>, delayMs: number): Accessor<boolean> {
  const [deferred, setDeferred] = createSignal(false)

  createEffect(() => {
    const value = source()

    if (value) {
      const timer = setTimeout(() => setDeferred(true), delayMs)
      onCleanup(() => clearTimeout(timer))
    } else {
      setDeferred(false)
    }
  })

  return deferred
}
