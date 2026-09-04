const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000

let requestGate: Promise<void> = Promise.resolve()
let nextRequestAt = 0
let rateLimitedUntil = 0

export class StoreRequestError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'StoreRequestError'
    this.code = code
  }
}

/**
 * Spaces requests to the store across page and artwork callers. The promise
 * chain only reserves start times; slow responses do not block unrelated cache
 * hits or keep the whole store serialised.
 */
export function reserveStoreRequestSlot(minimumIntervalMs: number): Promise<void> {
  const interval = Math.max(0, Math.min(5000, Number(minimumIntervalMs) || 0))
  const reservation = requestGate.then(async () => {
    const delay = Math.max(0, nextRequestAt - Date.now())
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    nextRequestAt = Date.now() + interval
  })
  requestGate = reservation.catch(() => {})
  return reservation
}

export function getStoreCooldownMs(): number {
  return Math.max(0, rateLimitedUntil - Date.now())
}

export function noteStoreRateLimit(retryAfter: string | null): number {
  const seconds = Number(retryAfter)
  const retryAt = Number.isFinite(seconds) && seconds >= 0
    ? Date.now() + seconds * 1000
    : retryAfter && Number.isFinite(Date.parse(retryAfter))
      ? Date.parse(retryAfter)
      : 0

  rateLimitedUntil = Math.max(
    rateLimitedUntil,
    retryAt,
    Date.now() + DEFAULT_RATE_LIMIT_COOLDOWN_MS
  )
  return getStoreCooldownMs()
}
