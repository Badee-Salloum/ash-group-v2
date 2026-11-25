import { describe, it, expect, beforeEach } from 'vitest'
import { rateLimit } from '@/lib/rateLimit'

// Each test uses a UNIQUE key to avoid bleed-through (the bucket Map is module-scoped)

describe('rateLimit — sliding window in-memory', () => {
  it('allows the first N requests', () => {
    const key = `t1-${Date.now()}-${Math.random()}`
    for (let i = 0; i < 5; i++) {
      const r = rateLimit(key, { limit: 5, windowMs: 60_000 })
      expect(r.ok, `request ${i + 1} should be allowed`).toBe(true)
    }
  })

  it('blocks the (N+1)th request within the window', () => {
    const key = `t2-${Date.now()}-${Math.random()}`
    for (let i = 0; i < 3; i++) rateLimit(key, { limit: 3, windowMs: 60_000 })
    const blocked = rateLimit(key, { limit: 3, windowMs: 60_000 })
    expect(blocked.ok).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.resetInMs).toBeGreaterThan(0)
  })

  it('different keys have independent buckets', () => {
    const k1 = `t3-a-${Date.now()}`
    const k2 = `t3-b-${Date.now()}`
    rateLimit(k1, { limit: 1, windowMs: 60_000 })
    const blockedK1 = rateLimit(k1, { limit: 1, windowMs: 60_000 })
    const allowedK2 = rateLimit(k2, { limit: 1, windowMs: 60_000 })
    expect(blockedK1.ok).toBe(false)
    expect(allowedK2.ok).toBe(true)
  })

  it('reports remaining count correctly', () => {
    const key = `t4-${Date.now()}-${Math.random()}`
    const r1 = rateLimit(key, { limit: 5, windowMs: 60_000 })
    expect(r1.remaining).toBe(4)
    const r2 = rateLimit(key, { limit: 5, windowMs: 60_000 })
    expect(r2.remaining).toBe(3)
  })

  it('resets bucket after windowMs elapses', async () => {
    const key = `t5-${Date.now()}-${Math.random()}`
    rateLimit(key, { limit: 1, windowMs: 50 })
    const blocked = rateLimit(key, { limit: 1, windowMs: 50 })
    expect(blocked.ok).toBe(false)
    await new Promise(r => setTimeout(r, 80))
    const reset = rateLimit(key, { limit: 1, windowMs: 50 })
    expect(reset.ok).toBe(true)
  })
})
