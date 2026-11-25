import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock state holders — defined in vi.hoisted so the mock factories see them.
const mocks = vi.hoisted(() => ({
  sessionFindFirst: vi.fn(),
  sessionCreate: vi.fn(),
  shiftFindMany: vi.fn(),
  userFindMany: vi.fn(),
  getSession: vi.fn(),
  tryAutoApprove: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  db: {
    shiftSession: { findFirst: mocks.sessionFindFirst, create: mocks.sessionCreate },
    shift: { findMany: mocks.shiftFindMany },
    user: { findMany: mocks.userFindMany },
  },
}))
vi.mock('@/lib/auth', async () => {
  const real = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...real, getSession: () => mocks.getSession(), audit: () => Promise.resolve() }
})
vi.mock('@/lib/shifts/autoApprove', () => ({
  tryAutoApproveHandover: (...a: unknown[]) => mocks.tryAutoApprove(...a),
}))

import { POST } from '@/app/api/shifts/sessions/route'

function req(): Request {
  return new Request('http://localhost/api/shifts/sessions', { method: 'POST' })
}

// Fake "now" = 2026-05-14 12:00 Damascus (09:00 UTC). Shift ONE's window
// (05:00–14:00 Damascus) is open; shift TWO's (13:00–22:00) is not.
const NOW = new Date('2026-05-14T09:00:00Z')

function shiftRow(over: Record<string, unknown>) {
  return {
    id: 'sh1',
    date: new Date('2026-05-14T00:00:00Z'),
    shiftNumber: 'ONE',
    isDayOff: false,
    handoverFromUserIds: [],
    wallets: [{ accountId: 'W1' }],
    ...over,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  for (const m of Object.values(mocks)) m.mockReset()
  mocks.getSession.mockResolvedValue({ userId: 'u1', role: 'EMPLOYEE', email: 'a@b', name: 'X' })
  mocks.tryAutoApprove.mockResolvedValue({ approved: false, reason: 'في انتظار' })
})
afterEach(() => vi.useRealTimers())

describe('POST check-in — schedule resolution', () => {
  it('403 when the employee has no scheduled shift', async () => {
    mocks.sessionFindFirst.mockResolvedValueOnce(null) // no open session
    mocks.shiftFindMany.mockResolvedValueOnce([])      // not scheduled
    const res = await POST(req() as never)
    expect(res.status).toBe(403)
    const b = await res.json()
    expect(b.error).toMatch(/مجدول/)
  })

  it('403 when scheduled but the shift window is closed now', async () => {
    mocks.sessionFindFirst.mockResolvedValueOnce(null)
    // Shift TWO window is 13:00–22:00 Damascus — closed at 12:00.
    mocks.shiftFindMany.mockResolvedValueOnce([shiftRow({ shiftNumber: 'TWO' })])
    const res = await POST(req() as never)
    expect(res.status).toBe(403)
  })

  it('409 when the employee already has an open session', async () => {
    mocks.sessionFindFirst.mockResolvedValueOnce({ id: 'open1' })
    const res = await POST(req() as never)
    expect(res.status).toBe(409)
    expect(mocks.shiftFindMany).not.toHaveBeenCalled()
  })
})

describe('POST check-in — multi-source handover gate', () => {
  it('409 when a handover source is still ACTIVE (not requested check-out)', async () => {
    mocks.sessionFindFirst
      .mockResolvedValueOnce(null)                       // open-session check
      .mockResolvedValueOnce({ status: 'ACTIVE' })        // source A1's latest session
    mocks.shiftFindMany.mockResolvedValueOnce([
      shiftRow({ handoverFromUserIds: ['A1'] }),
    ])
    mocks.userFindMany.mockResolvedValueOnce([{ name: 'علي' }])
    const res = await POST(req() as never)
    expect(res.status).toBe(409)
    const b = await res.json()
    expect(b.error).toMatch(/في انتظار تسجيل خروج/)
    expect(b.error).toMatch(/علي/)
    expect(mocks.sessionCreate).not.toHaveBeenCalled()
  })

  it('creates PENDING_START when every source is PENDING_END', async () => {
    mocks.sessionFindFirst
      .mockResolvedValueOnce(null)                          // open check
      .mockResolvedValueOnce({ status: 'PENDING_END' })      // source A1
    mocks.shiftFindMany.mockResolvedValueOnce([
      shiftRow({ handoverFromUserIds: ['A1'] }),
    ])
    mocks.sessionCreate.mockResolvedValueOnce({ id: 'new1', status: 'PENDING_START' })
    const res = await POST(req() as never)
    expect(res.status).toBe(200)
    expect(mocks.sessionCreate).toHaveBeenCalledTimes(1)
    expect(mocks.sessionCreate.mock.calls[0][0].data.status).toBe('PENDING_START')
    expect(mocks.tryAutoApprove).toHaveBeenCalledTimes(1)
  })

  it('checks in directly as ACTIVE when there are no handover sources', async () => {
    mocks.sessionFindFirst.mockResolvedValueOnce(null)
    mocks.shiftFindMany.mockResolvedValueOnce([
      shiftRow({ handoverFromUserIds: [] }),
    ])
    mocks.sessionCreate.mockResolvedValueOnce({ id: 'new1', status: 'ACTIVE' })
    const res = await POST(req() as never)
    expect(res.status).toBe(200)
    expect(mocks.sessionCreate.mock.calls[0][0].data.status).toBe('ACTIVE')
    expect(mocks.tryAutoApprove).not.toHaveBeenCalled()
  })

  it('copies shiftNumber + wallets from the scheduled shift, not the client', async () => {
    mocks.sessionFindFirst.mockResolvedValueOnce(null)
    mocks.shiftFindMany.mockResolvedValueOnce([
      shiftRow({ shiftNumber: 'ONE', wallets: [{ accountId: 'W1' }, { accountId: 'W2' }] }),
    ])
    mocks.sessionCreate.mockResolvedValueOnce({ id: 'n', status: 'ACTIVE' })
    await POST(req() as never)
    const data = mocks.sessionCreate.mock.calls[0][0].data
    expect(data.shiftNumber).toBe('ONE')
    expect(data.wallets.create).toEqual([{ accountId: 'W1' }, { accountId: 'W2' }])
  })
})
