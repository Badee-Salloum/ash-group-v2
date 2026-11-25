import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  requireRole: vi.fn(),
  getBonusThresholds: vi.fn(),
  db: {
    $queryRawUnsafe: vi.fn(),
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    transaction: {
      count: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: mocks.getSession,
  requireRole: mocks.requireRole,
}))
vi.mock('@/lib/settings/global', () => ({
  getBonusThresholds: mocks.getBonusThresholds,
}))
vi.mock('@/lib/db/client', () => ({ db: mocks.db }))

import { GET as getErrorSummary } from '@/app/api/manager/errors/route'
import { GET as getErrorTransactions } from '@/app/api/manager/errors/transactions/route'

function request(path: string): NextRequest {
  return { nextUrl: new URL(`http://localhost${path}`) } as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({
    userId: 'manager-1',
    email: 'manager@example.com',
    name: 'Branch Manager',
    role: 'MANAGER',
  })
  mocks.getBonusThresholds.mockResolvedValue({
    ratioLimit: 0.001,
    amountLimits: { SYP: 20, USD: 20 },
    delayLimit: 0,
  })
  mocks.db.transaction.groupBy.mockResolvedValue([])
  mocks.db.transaction.findMany.mockResolvedValue([])
  mocks.db.transaction.count.mockResolvedValue(0)
  mocks.db.$queryRawUnsafe.mockResolvedValue([])
})

describe('GET /api/manager/errors', () => {
  it('shows a branch manager every active EMPLOYEE account without requiring managerId', async () => {
    mocks.db.user.findMany.mockResolvedValueOnce([{
      id: 'employee-without-manager',
      name: 'Employee',
      employeeCode: 'EMP-0001',
      avatarUrl: null,
      role: 'EMPLOYEE',
    }])

    const response = await getErrorSummary(request('/api/manager/errors?from=2026-08-08&to=2026-08-14'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0]).toMatchObject({ id: 'employee-without-manager', handled: 0, errors: 0 })
    expect(mocks.db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true, role: 'EMPLOYEE' },
    }))
    expect(mocks.db.user.findMany.mock.calls[0][0].where).not.toHaveProperty('managerId')
  })
})

describe('GET /api/manager/errors/transactions', () => {
  it('allows a branch manager to inspect any active EMPLOYEE account', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce({ role: 'EMPLOYEE', isActive: true })

    const response = await getErrorTransactions(request(
      '/api/manager/errors/transactions?employeeId=employee-without-manager&from=2026-08-08&to=2026-08-14',
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: true, rows: [] })
    expect(mocks.db.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'employee-without-manager' },
      select: { role: true, isActive: true },
    })
    expect(mocks.db.transaction.findMany).toHaveBeenCalledOnce()
  })

  it('shows transaction notes when review notes are empty and prefers review notes when present', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce({ role: 'EMPLOYEE', isActive: true })
    mocks.db.transaction.findMany.mockResolvedValueOnce([
      {
        id: 'tx-general-note',
        reviewedBy: null,
        notes: 'لا يوجد طلب سحب',
        reviewNotes: null,
      },
      {
        id: 'tx-review-note',
        reviewedBy: null,
        notes: 'ملاحظة العملية',
        reviewNotes: 'ملاحظة المراجعة',
      },
    ])

    const response = await getErrorTransactions(request(
      '/api/manager/errors/transactions?employeeId=employee-1',
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.rows).toEqual([
      expect.objectContaining({ id: 'tx-general-note', displayNotes: 'لا يوجد طلب سحب' }),
      expect.objectContaining({ id: 'tx-review-note', displayNotes: 'ملاحظة المراجعة' }),
    ])
    expect(mocks.db.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ notes: true, reviewNotes: true }),
    }))
  })

  it('keeps non-employee accounts outside a branch manager scope', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce({ role: 'SHIFT_MANAGER', isActive: true })

    const response = await getErrorTransactions(request(
      '/api/manager/errors/transactions?employeeId=shift-manager-1',
    ))

    expect(response.status).toBe(403)
    expect(mocks.db.transaction.findMany).not.toHaveBeenCalled()
  })

  it('keeps inactive employee accounts outside the active dashboard scope', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce({ role: 'EMPLOYEE', isActive: false })

    const response = await getErrorTransactions(request(
      '/api/manager/errors/transactions?employeeId=inactive-employee',
    ))

    expect(response.status).toBe(403)
    expect(mocks.db.transaction.findMany).not.toHaveBeenCalled()
  })
})
