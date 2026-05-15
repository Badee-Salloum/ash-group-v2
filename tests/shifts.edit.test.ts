import { describe, it, expect, beforeEach, vi } from 'vitest'

// vi.mock factories run BEFORE imports, so the mock-state holders must be
// defined inside vi.hoisted() to be visible there.
const mocks = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  sessionUpdate: vi.fn(),
  walletDeleteMany: vi.fn(),
  walletCreateMany: vi.fn(),
  employeeWalletFindMany: vi.fn(),
  auditLogCreate: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  db: {
    shiftSession: { findUnique: mocks.sessionFindUnique, update: mocks.sessionUpdate },
    shiftSessionWallet: { deleteMany: mocks.walletDeleteMany, createMany: mocks.walletCreateMany },
    employeeWalletAssignment: { findMany: mocks.employeeWalletFindMany },
    auditLog: { create: mocks.auditLogCreate },
    $transaction: (cb: (tx: unknown) => unknown) => cb({
      shiftSession: { update: mocks.sessionUpdate },
      shiftSessionWallet: { deleteMany: mocks.walletDeleteMany, createMany: mocks.walletCreateMany },
    }),
  },
}))

vi.mock('@/lib/auth', async () => {
  const real = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...real,
    getSession: () => mocks.getSession(),
    audit: () => Promise.resolve(),
  }
})

// Aliases so the rest of the file reads cleanly.
const sessionFindUniqueMock = mocks.sessionFindUnique
const sessionUpdateMock = mocks.sessionUpdate
const walletDeleteManyMock = mocks.walletDeleteMany
const walletCreateManyMock = mocks.walletCreateMany
const employeeWalletFindManyMock = mocks.employeeWalletFindMany
const auditLogCreateMock = mocks.auditLogCreate
const getSessionMock = mocks.getSession

import { PATCH } from '@/app/api/shifts/sessions/route'

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/shifts/sessions', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  for (const m of [
    sessionFindUniqueMock, sessionUpdateMock,
    walletDeleteManyMock, walletCreateManyMock,
    employeeWalletFindManyMock, auditLogCreateMock,
    getSessionMock,
  ]) m.mockReset()
  sessionUpdateMock.mockResolvedValue({ id: 'sess1' })
  walletDeleteManyMock.mockResolvedValue({ count: 0 })
  walletCreateManyMock.mockResolvedValue({ count: 0 })
})

describe('PATCH /api/shifts/sessions edit — permissions', () => {
  it('self user can edit notes on their own ACTIVE session', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', role: 'EMPLOYEE', email: 'a@b', name: 'X' })
    sessionFindUniqueMock.mockResolvedValueOnce({
      id: 'sess1', userId: 'u1', status: 'ACTIVE', shiftNumber: 'ONE', startAt: new Date(),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(makeReq({ action: 'edit', sessionId: 'sess1', notes: 'fixed' }) as any)
    expect(res.status).toBe(200)
    expect(sessionUpdateMock).toHaveBeenCalledTimes(1)
    expect(sessionUpdateMock.mock.calls[0][0].data).toEqual({ notes: 'fixed' })
  })

  it('rejects self user editing someone else\'s session', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', role: 'EMPLOYEE', email: 'a@b', name: 'X' })
    sessionFindUniqueMock.mockResolvedValueOnce({
      id: 'sess1', userId: 'OTHER', status: 'ACTIVE', shiftNumber: 'ONE', startAt: new Date(),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(makeReq({ action: 'edit', sessionId: 'sess1', notes: 'hax' }) as any)
    expect(res.status).toBe(403)
    expect(sessionUpdateMock).not.toHaveBeenCalled()
  })

  it('rejects self user editing their CLOSED session', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', role: 'EMPLOYEE', email: 'a@b', name: 'X' })
    sessionFindUniqueMock.mockResolvedValueOnce({
      id: 'sess1', userId: 'u1', status: 'COMPLETED', shiftNumber: 'ONE', startAt: new Date(),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(makeReq({ action: 'edit', sessionId: 'sess1', notes: 'late' }) as any)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/المشرف/)
  })

  it('admin can edit a closed session including shiftNumber + endAt', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', role: 'ADMIN', email: 'a@b', name: 'A' })
    const startAt = new Date('2026-05-14T03:00:00Z')
    sessionFindUniqueMock.mockResolvedValueOnce({
      id: 'sess1', userId: 'u1', status: 'COMPLETED', shiftNumber: 'ONE', startAt,
    })
    const newEnd = '2026-05-14T11:00:00.000Z'
    const res = await PATCH(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeReq({ action: 'edit', sessionId: 'sess1', shiftNumber: 'TWO', endAt: newEnd }) as any,
    )
    expect(res.status).toBe(200)
    const args = sessionUpdateMock.mock.calls[0][0]
    expect(args.data.shiftNumber).toBe('TWO')
    expect((args.data.endAt as Date).toISOString()).toBe(newEnd)
    // 8 hours = 480 minutes
    expect(args.data.durationMinutes).toBe(480)
  })

  it('rejects non-admin attempting to set shiftNumber', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', role: 'EMPLOYEE', email: 'a@b', name: 'X' })
    sessionFindUniqueMock.mockResolvedValueOnce({
      id: 'sess1', userId: 'u1', status: 'ACTIVE', shiftNumber: 'ONE', startAt: new Date(),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(makeReq({ action: 'edit', sessionId: 'sess1', shiftNumber: 'TWO' }) as any)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/توقيت|رقم/)
  })
})

describe('PATCH /api/shifts/sessions edit — wallets', () => {
  it('rejects walletIds that aren\'t in the employee\'s allowed list', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', role: 'EMPLOYEE', email: 'a@b', name: 'X' })
    sessionFindUniqueMock.mockResolvedValueOnce({
      id: 'sess1', userId: 'u1', status: 'ACTIVE', shiftNumber: 'ONE', startAt: new Date(),
    })
    // Allowed = only W1; user tries to set [W1, W_BAD]
    employeeWalletFindManyMock.mockResolvedValueOnce([{ accountId: 'W1' }])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(makeReq({ action: 'edit', sessionId: 'sess1', walletIds: ['W1', 'W_BAD'] }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/1 محفظة/)
    expect(walletDeleteManyMock).not.toHaveBeenCalled()
  })

  it('replaces the wallet set when all ids are allowed', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', role: 'EMPLOYEE', email: 'a@b', name: 'X' })
    sessionFindUniqueMock.mockResolvedValueOnce({
      id: 'sess1', userId: 'u1', status: 'ACTIVE', shiftNumber: 'ONE', startAt: new Date(),
    })
    employeeWalletFindManyMock.mockResolvedValueOnce([
      { accountId: 'W1' }, { accountId: 'W2' },
    ])
    const res = await PATCH(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeReq({ action: 'edit', sessionId: 'sess1', walletIds: ['W1', 'W2'] }) as any,
    )
    expect(res.status).toBe(200)
    expect(walletDeleteManyMock).toHaveBeenCalledTimes(1)
    expect(walletCreateManyMock).toHaveBeenCalledTimes(1)
    expect(walletCreateManyMock.mock.calls[0][0].data).toEqual([
      { sessionId: 'sess1', accountId: 'W1' },
      { sessionId: 'sess1', accountId: 'W2' },
    ])
  })
})

describe('PATCH /api/shifts/sessions edit — validation', () => {
  it('returns 404 when session does not exist', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', role: 'ADMIN', email: 'a@b', name: 'A' })
    sessionFindUniqueMock.mockResolvedValueOnce(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(makeReq({ action: 'edit', sessionId: 'nope', notes: 'x' }) as any)
    expect(res.status).toBe(404)
  })

  it('returns 401 with no session cookie', async () => {
    getSessionMock.mockResolvedValue(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(makeReq({ action: 'edit', sessionId: 'sess1', notes: 'x' }) as any)
    expect(res.status).toBe(401)
  })
})
