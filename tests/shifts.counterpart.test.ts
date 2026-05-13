import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  db: { shiftSession: { findMany: mocks.findMany } },
}))
vi.mock('@/lib/auth', () => ({
  getSession: mocks.getSession,
}))

const { findMany, getSession } = mocks

import { GET } from '@/app/api/shifts/sessions/counterpart/route'

function makeReq(qs: string): Request {
  return new Request(`http://localhost/api/shifts/sessions/counterpart?${qs}`)
}

beforeEach(() => {
  findMany.mockReset()
  getSession.mockReset().mockResolvedValue({ userId: 'u1', role: 'EMPLOYEE' })
})

describe('GET /api/shifts/sessions/counterpart', () => {
  it('returns 400 when walletIds is missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeReq('') as any)
    expect(res.status).toBe(400)
  })

  it('returns counterpart when one open session holds the requested wallets', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 'sess-1',
        status: 'ACTIVE',
        user: { id: 'u-out', name: 'محمد علي' },
        wallets: [{ accountId: 'w1' }, { accountId: 'w2' }],
      },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeReq('walletIds=w1,w2') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.counterpart).toEqual({ id: 'u-out', name: 'محمد علي' })
    expect(body.sessionId).toBe('sess-1')
    expect(body.sessionStatus).toBe('ACTIVE')
  })

  it('returns counterpart:null when no open session holds the wallets', async () => {
    findMany.mockResolvedValueOnce([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeReq('walletIds=wX') as any)
    const body = await res.json()
    expect(body.counterpart).toBeNull()
    expect(body.ambiguous).toBeUndefined()
  })

  it('returns ambiguous when two users hold the same wallet set', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 's1', status: 'ACTIVE',
        user: { id: 'u-a', name: 'A' },
        wallets: [{ accountId: 'w1' }, { accountId: 'w2' }],
      },
      {
        id: 's2', status: 'PENDING_END',
        user: { id: 'u-b', name: 'B' },
        wallets: [{ accountId: 'w1' }, { accountId: 'w2' }],
      },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeReq('walletIds=w1,w2') as any)
    const body = await res.json()
    expect(body.counterpart).toBeNull()
    expect(body.ambiguous).toBe(true)
    expect(body.candidates).toHaveLength(2)
    expect(body.candidates.map((c: { name: string }) => c.name).sort()).toEqual(['A', 'B'])
  })

  it('excludes sessions that hold only a subset of requested wallets', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 's1', status: 'ACTIVE',
        user: { id: 'u-a', name: 'A' },
        wallets: [{ accountId: 'w1' }], // missing w2
      },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeReq('walletIds=w1,w2') as any)
    const body = await res.json()
    expect(body.counterpart).toBeNull()
  })

  it('only considers ACTIVE / PENDING_END sessions (DB-level filter)', async () => {
    findMany.mockResolvedValueOnce([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await GET(makeReq('walletIds=w1') as any)
    const whereArg = (findMany.mock.calls[0][0] as { where: { status: { in: string[] } } }).where
    expect(whereArg.status.in.sort()).toEqual(['ACTIVE', 'PENDING_END'])
  })

  it('returns 401 when not authenticated', async () => {
    getSession.mockResolvedValueOnce(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeReq('walletIds=w1') as any)
    expect(res.status).toBe(401)
  })
})
