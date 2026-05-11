import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the DB client before importing the route — Vitest hoists vi.mock calls
// above imports so the mock is in place when route.ts loads.
const findUniqueMock = vi.fn()
const createMock = vi.fn()
vi.mock('@/lib/db/client', () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      create: (...args: unknown[]) => createMock(...args),
    },
  },
}))

// rateLimit is a real module — but we replace it so the test doesn't trip on
// shared state between cases.
const rateLimitMock = vi.fn(() => ({ ok: true, remaining: 4, resetInMs: 0 }))
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}))

import { POST } from '@/app/api/auth/signup/route'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  findUniqueMock.mockReset()
  createMock.mockReset()
  rateLimitMock.mockReset().mockReturnValue({ ok: true, remaining: 4, resetInMs: 0 })
})

describe('POST /api/auth/signup — validation', () => {
  it('rejects short name', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeRequest({ name: 'A', email: 'a@b.co', password: 'LongEnough1' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/حرفين/)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('rejects invalid email', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeRequest({ name: 'Ahmed', email: 'not-an-email', password: 'LongEnough1' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/البريد/)
  })

  it('rejects short password', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeRequest({ name: 'Ahmed', email: 'a@b.co', password: 'Sh0rt' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/8 أحرف/)
  })

  it('rejects password missing uppercase', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeRequest({ name: 'Ahmed', email: 'a@b.co', password: 'lowercase1' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/كبير/)
  })

  it('rejects password missing digit', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeRequest({ name: 'Ahmed', email: 'a@b.co', password: 'NoDigitsHere' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/رقم/)
  })

  it('rejects missing fields', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeRequest({ name: 'Ahmed' }) as any)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth/signup — duplicate email', () => {
  it('returns 409 with Arabic message when email already registered', async () => {
    findUniqueMock.mockResolvedValueOnce({ id: 'existing-user-id' })
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ name: 'Ahmed', email: 'taken@co.com', password: 'LongEnough1' }) as any,
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/مسجّل مسبقاً/)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('converts a Prisma P2002 race into a 409 (not 500)', async () => {
    // Two concurrent signups for the same email: both pass findUnique, the
    // second hits the unique constraint at insert time.
    findUniqueMock.mockResolvedValueOnce(null)
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    createMock.mockRejectedValueOnce(p2002)
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ name: 'Ahmed', email: 'race@co.com', password: 'LongEnough1' }) as any,
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/مسجّل مسبقاً/)
  })
})

describe('POST /api/auth/signup — happy path', () => {
  it('creates an inactive EMPLOYEE user with bcrypt-hashed password', async () => {
    findUniqueMock.mockResolvedValueOnce(null)
    createMock.mockResolvedValueOnce({ id: 'new-user-id' })

    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ name: '  Ahmed Ali  ', email: 'Ahmed@Co.com', password: 'LongEnough1' }) as any,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.message).toMatch(/التفعيل/)

    expect(createMock).toHaveBeenCalledTimes(1)
    const args = createMock.mock.calls[0][0]
    // name is trimmed
    expect(args.data.name).toBe('Ahmed Ali')
    // email is lower-cased
    expect(args.data.email).toBe('ahmed@co.com')
    // password is hashed (not stored as plaintext)
    expect(args.data.passwordHash).not.toBe('LongEnough1')
    expect(args.data.passwordHash).toMatch(/^\$2[aby]\$/) // bcrypt signature
    // role + active state are forced
    expect(args.data.role).toBe('EMPLOYEE')
    expect(args.data.isActive).toBe(false)
  })

  it('lower-cases the email before checking for duplicates', async () => {
    findUniqueMock.mockResolvedValueOnce(null)
    createMock.mockResolvedValueOnce({ id: 'u' })

    await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ name: 'Sara', email: 'SARA@CO.COM', password: 'LongEnough1' }) as any,
    )
    const findArgs = findUniqueMock.mock.calls[0][0]
    expect(findArgs.where.email).toBe('sara@co.com')
  })
})

describe('POST /api/auth/signup — rate limit', () => {
  it('returns 429 with retry-after when limit exceeded', async () => {
    rateLimitMock.mockReturnValueOnce({ ok: false, remaining: 0, resetInMs: 120_000 })
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ name: 'Ahmed', email: 'a@b.co', password: 'LongEnough1' }) as any,
    )
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/محاولات كثيرة/)
    expect(body.error).toMatch(/2 دقيقة/) // 120000 ms / 60000 → 2 minutes
    expect(findUniqueMock).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('keys rate limit by client IP', async () => {
    rateLimitMock.mockReturnValueOnce({ ok: true, remaining: 4, resetInMs: 0 })
    findUniqueMock.mockResolvedValueOnce(null)
    createMock.mockResolvedValueOnce({ id: 'u' })
    await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ name: 'Ahmed', email: 'a@b.co', password: 'LongEnough1' }) as any,
    )
    expect(rateLimitMock).toHaveBeenCalled()
    const key = rateLimitMock.mock.calls[0][0] as string
    expect(key).toContain('signup')
    expect(key).toContain('1.2.3.4')
  })
})
