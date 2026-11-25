import { describe, it, expect, vi, beforeEach } from 'vitest'

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    bonusLog: { create: vi.fn(), createMany: vi.fn() },
  },
}))

vi.mock('@/lib/db/client', () => ({ db: dbMock }))
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ userId: 'admin', email: 'a@b.c', name: 'A', role: 'ADMIN' })),
  requireRole: vi.fn(),
  audit: vi.fn(),
}))

import { POST } from '@/app/api/bonuses/route'
import type { NextRequest } from 'next/server'

function makeReq(body: unknown): NextRequest {
  return {
    json: async () => body,
    nextUrl: new URL('http://localhost/api/bonuses'),
  } as unknown as NextRequest
}

describe('POST /api/bonuses — percent option', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.bonusLog.create.mockResolvedValue({ id: 'b1' })
    dbMock.bonusLog.createMany.mockResolvedValue({})
  })

  describe('MANUAL type', () => {
    it('computes amount from percent × salary', async () => {
      dbMock.user.findUnique.mockResolvedValueOnce({ baseSalary: 200_000 })
      const res = await POST(makeReq({
        type: 'MANUAL', userId: 'u1', percent: 10, reason: 'مكافأة شهرية',
      }))
      const d = await res.json()
      expect(d.success).toBe(true)
      // Captured amount = 200_000 × 10% = 20_000.
      const calledData = (dbMock.bonusLog.create.mock.calls[0][0] as { data: { amount: number; reason: string } }).data
      expect(calledData.amount).toBe(20_000)
      expect(calledData.reason).toMatch(/\[10%\]/)
    })

    it('rejects when both amount and percent supplied', async () => {
      const res = await POST(makeReq({
        type: 'MANUAL', userId: 'u1', percent: 10, amount: 5000,
      }))
      expect(res.status).toBe(400)
      const d = await res.json()
      expect(d.error).toMatch(/إما المبلغ أو النسبة/)
    })

    it('rejects when employee has no baseSalary', async () => {
      dbMock.user.findUnique.mockResolvedValueOnce({ baseSalary: null })
      const res = await POST(makeReq({
        type: 'MANUAL', userId: 'u1', percent: 10,
      }))
      expect(res.status).toBe(400)
      const d = await res.json()
      expect(d.error).toMatch(/راتب أساس/)
    })

    it('still supports fixed amount path', async () => {
      const res = await POST(makeReq({
        type: 'MANUAL', userId: 'u1', amount: 15_000,
      }))
      const d = await res.json()
      expect(d.success).toBe(true)
      const calledData = (dbMock.bonusLog.create.mock.calls[0][0] as { data: { amount: number } }).data
      expect(calledData.amount).toBe(15_000)
    })
  })

  describe('GROUP type', () => {
    it('computes per-user amounts from percent × each salary', async () => {
      dbMock.user.findMany.mockResolvedValueOnce([
        { id: 'u1', baseSalary: 100_000 },
        { id: 'u2', baseSalary: 200_000 },
        { id: 'u3', baseSalary: 300_000 },
      ])
      const res = await POST(makeReq({
        type: 'GROUP', percent: 5, userIds: ['u1', 'u2', 'u3'],
      }))
      const d = await res.json()
      expect(d.success).toBe(true)
      expect(d.count).toBe(3)
      const inserted = (dbMock.bonusLog.createMany.mock.calls[0][0] as { data: Array<{ userId: string; amount: number }> }).data
      expect(inserted.find(r => r.userId === 'u1')!.amount).toBe(5_000)
      expect(inserted.find(r => r.userId === 'u2')!.amount).toBe(10_000)
      expect(inserted.find(r => r.userId === 'u3')!.amount).toBe(15_000)
    })

    it('skips users without baseSalary and reports them', async () => {
      dbMock.user.findMany.mockResolvedValueOnce([
        { id: 'u1', baseSalary: 100_000 },
        { id: 'u2', baseSalary: null },
        { id: 'u3', baseSalary: 200_000 },
      ])
      const res = await POST(makeReq({
        type: 'GROUP', percent: 5, userIds: ['u1', 'u2', 'u3'],
      }))
      const d = await res.json()
      expect(d.success).toBe(true)
      expect(d.count).toBe(2)
      expect(d.skippedNoSalary).toBe(1)
      const inserted = (dbMock.bonusLog.createMany.mock.calls[0][0] as { data: Array<{ userId: string }> }).data
      expect(inserted.find(r => r.userId === 'u2')).toBeUndefined()
    })

    it('rejects when no users have a salary in percent mode', async () => {
      dbMock.user.findMany.mockResolvedValueOnce([
        { id: 'u1', baseSalary: null },
        { id: 'u2', baseSalary: null },
      ])
      const res = await POST(makeReq({
        type: 'GROUP', percent: 5, userIds: ['u1', 'u2'],
      }))
      expect(res.status).toBe(400)
      const d = await res.json()
      expect(d.error).toMatch(/راتب/)
      expect(dbMock.bonusLog.createMany).not.toHaveBeenCalled()
    })

    it('rejects when both amount and percent supplied', async () => {
      const res = await POST(makeReq({
        type: 'GROUP', userIds: ['u1'], amount: 5000, percent: 10,
      }))
      expect(res.status).toBe(400)
    })

    it('still supports fixed amount path', async () => {
      const res = await POST(makeReq({
        type: 'GROUP', userIds: ['u1', 'u2'], amount: 10_000,
      }))
      const d = await res.json()
      expect(d.success).toBe(true)
      const inserted = (dbMock.bonusLog.createMany.mock.calls[0][0] as { data: Array<{ amount: number }> }).data
      expect(inserted.every(r => r.amount === 10_000)).toBe(true)
    })
  })
})
