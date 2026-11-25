import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dbMock, cumulativeBatch, getEpoch } = vi.hoisted(() => ({
  dbMock: {
    user: { findMany: vi.fn() },
    payrollEntry: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    shiftSession: { findMany: vi.fn() },
    bonusLog: { groupBy: vi.fn(), aggregate: vi.fn() },
    advanceRequest: { findMany: vi.fn(), updateMany: vi.fn() },
  },
  cumulativeBatch: vi.fn(),
  getEpoch: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({ db: dbMock }))
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ userId: 'admin', role: 'ADMIN' })),
  requireRole: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@/lib/settings/global', () => ({ getPayrollEpochStart: getEpoch }))
vi.mock('@/lib/compensation/cumulativeBonus', () => ({
  computeCumulativeBonusBatch: cumulativeBatch,
}))
vi.mock('@/lib/notifications/helpers', () => ({
  createPayrollPaidNotification: vi.fn(),
  createDeductionNotification: vi.fn(),
}))

import { GET, POST } from '@/app/api/payroll/route'
import type { NextRequest } from 'next/server'

const weekStart = '2026-07-05'
const employees = [
  {
    id: 'u1', name: 'One', jobTitle: null, employeeCode: 'E1', avatarUrl: null,
    baseSalary: 700_000, hireDate: null, createdAt: new Date('2026-01-01'), weeklyOffDay: null, role: 'EMPLOYEE',
  },
  {
    id: 'u2', name: 'Two', jobTitle: null, employeeCode: 'E2', avatarUrl: null,
    baseSalary: 600_000, hireDate: null, createdAt: new Date('2026-01-01'), weeklyOffDay: 3, role: 'EMPLOYEE',
  },
]

function getRequest(): NextRequest {
  return { nextUrl: new URL(`http://localhost/api/payroll?weekStart=${weekStart}`) } as NextRequest
}

function postRequest(): NextRequest {
  return { json: async () => ({ weekStart }) } as NextRequest
}

describe('payroll batched reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getEpoch.mockResolvedValue('2026-06-28')
    cumulativeBatch.mockResolvedValue(new Map([
      ['u1', { cleanStreak: 2, amount: 10_000, lastErrorWeek: null }],
      ['u2', { cleanStreak: 1, amount: 5_000, lastErrorWeek: null }],
    ]))
    dbMock.user.findMany.mockResolvedValue(employees)
    dbMock.shiftSession.findMany.mockResolvedValue([
      { userId: 'u1', startAt: new Date('2026-07-05T10:00:00Z') },
      { userId: 'u1', startAt: new Date('2026-07-06T10:00:00Z') },
      { userId: 'u2', startAt: new Date('2026-07-05T10:00:00Z') },
    ])
    dbMock.bonusLog.groupBy.mockResolvedValue([
      { userId: 'u1', _sum: { amount: 500 } },
      { userId: 'u2', _sum: { amount: 250 } },
    ])
    dbMock.payrollEntry.findMany.mockResolvedValue([])
    dbMock.advanceRequest.findMany.mockResolvedValue([])
    dbMock.payrollEntry.create.mockImplementation(async ({ data }: { data: { userId: string } }) => ({ id: `p-${data.userId}` }))
    dbMock.payrollEntry.update.mockResolvedValue({})
    dbMock.advanceRequest.updateMany.mockResolvedValue({ count: 0 })
  })

  it('GET reads sessions and bonus totals once for all employees', async () => {
    const response = await GET(getRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toHaveLength(2)
    expect(body.data[0].workedHours).toBe(2)
    expect(body.data[0].bonusAmount).toBe(10_500)
    expect(body.data[1].workedHours).toBe(1)
    expect(body.data[1].bonusAmount).toBe(5_250)
    expect(dbMock.shiftSession.findMany).toHaveBeenCalledTimes(1)
    expect(dbMock.bonusLog.groupBy).toHaveBeenCalledTimes(1)
    expect(dbMock.bonusLog.aggregate).not.toHaveBeenCalled()
    expect(dbMock.payrollEntry.findMany).toHaveBeenCalledTimes(1)
    expect(cumulativeBatch).toHaveBeenCalledTimes(1)
  })

  it('POST batches reads and still links an employee advance to the created entry', async () => {
    dbMock.advanceRequest.findMany.mockResolvedValue([
      { id: 'a1', userId: 'u1', amount: 1_000 },
    ])

    const response = await POST(postRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: true, created: 2, refreshed: 0 })
    expect(dbMock.shiftSession.findMany).toHaveBeenCalledTimes(1)
    expect(dbMock.bonusLog.groupBy).toHaveBeenCalledTimes(1)
    expect(dbMock.advanceRequest.findMany).toHaveBeenCalledTimes(1)
    expect(dbMock.payrollEntry.findMany).toHaveBeenCalledTimes(1)
    expect(dbMock.payrollEntry.findUnique).not.toHaveBeenCalled()
    expect(cumulativeBatch).toHaveBeenCalledTimes(1)
    expect(dbMock.advanceRequest.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1'] } },
      data: { payrollEntryId: 'p-u1', status: 'PAID' },
    })
  })
})
