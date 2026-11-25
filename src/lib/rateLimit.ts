// Simple sliding-window rate limiter (in-memory).
// Good enough for single-instance deployments and as a defence-in-depth layer.
// For multi-region or high-scale, replace the Map with Redis/Upstash.

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

// Best-effort cleanup so the map doesn't grow unbounded.
let lastSweep = 0
function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k)
  }
}

export interface RateLimitResult {
  ok: boolean
  remaining: number
  resetInMs: number
}

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now()
  sweep(now)
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs })
    return { ok: true, remaining: opts.limit - 1, resetInMs: opts.windowMs }
  }
  b.count++
  if (b.count > opts.limit) {
    return { ok: false, remaining: 0, resetInMs: b.resetAt - now }
  }
  return { ok: true, remaining: opts.limit - b.count, resetInMs: b.resetAt - now }
}
