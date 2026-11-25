import { describe, it, expect, vi, beforeEach } from 'vitest'

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    bonusLog: { findUnique: vi.fn(), update: vi.fn() },
    payrollEntry: { findFirst: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('@/lib/db/client', () => ({ db: dbMock }))
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ userId: 'admin', email: 'a@b.c', name: 'A', role: 'ADMIN' })),
  requireRole: vi.fn(),
  audit: vi.fn(),
}))

import { PATCH } from '@/app/api/bonuses/[id]/route'
import type { NextRequest } from 'next/server'

function makeReq(body: unknown): NextRequest {
  return {
    json: async () => body,
    nextUrl: new URL('http://localhost/api/bonuses/x'),
  } as unknown as NextRequest
}

describe('PATCH /api/bonuses/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates amount + reason on a non-paid MANUAL bonus and syncs payroll', async () => {
    const weekStart = new Date('2026-06-07')
    dbMock.bonusLog.findUnique.mockResolvedValueOnce({
      id: 'b1', userId: 'u1', type: 'MANUAL', amount: 1000, reason: 'old', weekStart,
    })
    dbMock.payrollEntry.findFirst
      .mockResolvedValueOnce(null) // PAID-check returns nothing
      .mockResolvedValueOnce({ id: 'p1', bonusAmount: 5000, netAmount: 50_000 })
    dbMock.bonusLog.update.mockResolvedValueOnce({})
    dbMock.payrollEntry.update.mockResolvedValueOnce({})

    const res = await PATCH(makeReq({ amount: 1500, reason: 'new' }), { params: { id: 'b1' } })
    const d = await res.json()
    expect(d.success).toBe(true)
    expect(dbMock.bonusLog.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { amount: 1500, reason: 'new' },
    })
    // Payroll delta sync = +500.
    expect(dbMock.payrollEntry.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { bonusAmount: 5500, netAmount: 50_500 },
    })
  })

  it('refuses 403 when the bonus week is already PAID', async () => {
    const weekStart = new Date('2026-06-07')
    dbMock.bonusLog.findUnique.mockResolvedValueOnce({
      id: 'b1', userId: 'u1', type: 'MANUAL', amount: 1000, reason: 'old', weekStart,
    })
    dbMock.payrollEntry.findFirst.mockResolvedValueOnce({ id: 'p1' }) // PAID hit

    const res = await PATCH(makeReq({ amount: 1500 }), { params: { id: 'b1' } })
    expect(res.status).toBe(403)
    const d = await res.json()
    expect(d.error).toMatch(/مدفوعة/)
    expect(dbMock.bonusLog.update).not.toHaveBeenCalled()
  })

  it('returns 404 when the bonus does not exist', async () => {
    dbMock.bonusLog.findUnique.mockResolvedValueOnce(null)
    const res = await PATCH(makeReq({ amount: 1500 }), { params: { id: 'b1' } })
    expect(res.status).toBe(404)
  })

  it('returns 400 when no fields are supplied', async () => {
    const res = await PATCH(makeReq({}), { params: { id: 'b1' } })
    expect(res.status).toBe(400)
  })

  it('skips payroll-sync for CUMULATIVE bonuses', async () => {
    const weekStart = new Date('2026-06-07')
    dbMock.bonusLog.findUnique.mockResolvedValueOnce({
      id: 'b1', userId: 'u1', type: 'CUMULATIVE', amount: 5000, reason: null, weekStart,
    })
    dbMock.payrollEntry.findFirst.mockResolvedValueOnce(null) // PAID-check
    dbMock.bonusLog.update.mockResolvedValueOnce({})

    const res = await PATCH(makeReq({ amount: 7500 }), { params: { id: 'b1' } })
    const d = await res.json()
    expect(d.success).toBe(true)
    // PAID-check counts as 1; no payroll lookup or update for sync.
    expect(dbMock.payrollEntry.findFirst).toHaveBeenCalledTimes(1)
    expect(dbMock.payrollEntry.update).not.toHaveBeenCalled()
  })
})
