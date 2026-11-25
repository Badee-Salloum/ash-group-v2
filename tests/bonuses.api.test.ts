import { describe, it, expect, vi, beforeEach } from 'vitest'

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    bonusLog: { findUnique: vi.fn(), delete: vi.fn() },
    payrollEntry: { findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/db/client', () => ({ db: dbMock }))
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ userId: 'admin', email: 'a@b.c', name: 'A', role: 'ADMIN' })),
  requireRole: vi.fn(),
  audit: vi.fn(),
}))

import { DELETE } from '@/app/api/bonuses/route'
import type { NextRequest } from 'next/server'

function makeReq(id?: string): NextRequest {
  const url = id ? `http://localhost/api/bonuses?id=${id}` : 'http://localhost/api/bonuses'
  return { nextUrl: new URL(url) } as NextRequest
}

describe('DELETE /api/bonuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when id is missing', async () => {
    const res = await DELETE(makeReq())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('id')
  })

  it('returns 404 when bonus not found', async () => {
    dbMock.bonusLog.findUnique.mockResolvedValueOnce(null)
    const res = await DELETE(makeReq('xxx'))
    expect(res.status).toBe(404)
  })

  it('refuses delete when payroll for that week is PAID', async () => {
    dbMock.bonusLog.findUnique.mockResolvedValueOnce({
      id: 'b1', userId: 'u1', amount: 5000, type: 'GROUP',
      weekStart: new Date('2026-04-26'),
    })
    dbMock.payrollEntry.findFirst.mockResolvedValueOnce({ id: 'p1' })  // PAID exists

    const res = await DELETE(makeReq('b1'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('مدفوعة')
    expect(dbMock.bonusLog.delete).not.toHaveBeenCalled()
  })

  it('deletes when no PAID payroll exists for that week', async () => {
    dbMock.bonusLog.findUnique.mockResolvedValueOnce({
      id: 'b2', userId: 'u1', amount: 5000, type: 'GROUP',
      weekStart: new Date('2026-04-26'),
    })
    dbMock.payrollEntry.findFirst.mockResolvedValueOnce(null)  // not paid
    dbMock.bonusLog.delete.mockResolvedValueOnce({ id: 'b2' })

    const res = await DELETE(makeReq('b2'))
    expect(res.status).toBe(200)
    expect(dbMock.bonusLog.delete).toHaveBeenCalledWith({ where: { id: 'b2' } })
  })

  it('deletes when bonus has no weekStart (no PAID guard needed)', async () => {
    dbMock.bonusLog.findUnique.mockResolvedValueOnce({
      id: 'b3', userId: 'u1', amount: 1000, type: 'MANUAL',
      weekStart: null,
    })
    dbMock.bonusLog.delete.mockResolvedValueOnce({ id: 'b3' })

    const res = await DELETE(makeReq('b3'))
    expect(res.status).toBe(200)
    expect(dbMock.payrollEntry.findFirst).not.toHaveBeenCalled()
  })
})
