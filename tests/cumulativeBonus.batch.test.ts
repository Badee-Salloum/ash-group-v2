import { describe, it, expect, vi, beforeEach } from 'vitest'

// Batch mode uses a single findMany over the lookback window and buckets
// results in JS. Each row must carry the fields the threshold predicate
// reads: handledByUserId, txDateTime, reviewCategory, currency, amount,
// hasDelay. Legacy scenarios describe "dirty" weeks by injecting an
// EMPLOYEE_ERROR row on that week for the target user.
type TxRow = {
  handledByUserId: string
  txDateTime: Date
  reviewCategory: string | null
  currency: string
  amount: number
  hasDelay: boolean
}

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    transaction: {
      count: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where as Record<string, unknown>
        if ('hasDelay' in w) return 0
        return 1000
      }),
      groupBy: vi.fn(async () => [] as unknown[]),
      findMany: vi.fn(async () => [] as unknown[]),
    },
  },
}))

vi.mock('@/lib/db/client', () => ({ db: dbMock }))
vi.mock('@/lib/settings/global', () => ({
  getPayrollEpochStart: vi.fn(async () => '2000-01-02'),
  getBonusThresholds: vi.fn(async () => ({
    ratioLimit: 1e-9,
    amountLimits: {},
    delayLimit: 0,
  })),
}))
vi.mock('@/lib/compensation/bonusRules', () => ({
  getActiveBonusRule: vi.fn(async () => ({
    id: 'r1',
    name: 'test',
    config: {
      amountType: 'FIXED',
      baseAmount: 5000,
      cumulative: true,
      targetRoles: [],
      tiers: [],
    },
  })),
  applyBonusRule: (streak: number) => streak * 5000,
  ruleAppliesToRole: () => true,
}))

import {
  computeCumulativeBonusBatch,
  CUMULATIVE_PER_WEEK,
  MAX_LOOKBACK_WEEKS,
} from '@/lib/compensation/cumulativeBonus'

function dateAt(year: number, month: number, day: number) {
  const d = new Date(year, month - 1, day)
  d.setHours(0, 0, 0, 0)
  return d
}

function errRow(userId: string, at: Date) {
  return {
    handledByUserId: userId,
    txDateTime: new Date(at.getTime() + 1000),
    reviewCategory: 'EMPLOYEE_ERROR',
    currency: 'USD',
    amount: 0,
    hasDelay: false,
  }
}

describe('computeCumulativeBonusBatch', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('processes multiple employees in one findMany', async () => {
    const anchor = dateAt(2026, 6, 7)
    const u1Dirty = new Date(anchor); u1Dirty.setDate(anchor.getDate() - 14) // -2w
    const u2Dirty = new Date(anchor); u2Dirty.setDate(anchor.getDate() - 35) // -5w
    dbMock.transaction.findMany.mockResolvedValueOnce([
      errRow('u1', u1Dirty),
      errRow('u2', u2Dirty),
    ])
    const employees = [
      { id: 'u1', hireDate: dateAt(2020, 1, 1), createdAt: dateAt(2020, 1, 1) },
      { id: 'u2', hireDate: dateAt(2020, 1, 1), createdAt: dateAt(2020, 1, 1) },
    ]
    const result = await computeCumulativeBonusBatch(employees, anchor)
    expect(result.get('u1')!.cleanStreak).toBe(2)
    expect(result.get('u2')!.cleanStreak).toBe(5)
    expect(dbMock.transaction.findMany).toHaveBeenCalledTimes(1)
  })

  it('returns max streak for employees with no errors and old hire-date', async () => {
    dbMock.transaction.findMany.mockResolvedValueOnce([])
    const employees = [
      { id: 'u1', hireDate: dateAt(2020, 1, 1), createdAt: dateAt(2020, 1, 1) },
    ]
    const anchor = dateAt(2026, 6, 7)
    const result = await computeCumulativeBonusBatch(employees, anchor)
    expect(result.get('u1')!.cleanStreak).toBe(MAX_LOOKBACK_WEEKS)
    expect(result.get('u1')!.amount).toBe(MAX_LOOKBACK_WEEKS * CUMULATIVE_PER_WEEK)
  })

  it('respects hire-date boundary in batch mode', async () => {
    dbMock.transaction.findMany.mockResolvedValueOnce([])
    const anchor = dateAt(2026, 6, 7)
    // Hire mid-week 4 weeks before anchor → streak caps at 4.
    const hire = new Date(anchor); hire.setDate(anchor.getDate() - 7 * 3 - 3)
    const employees = [{ id: 'u1', hireDate: hire, createdAt: hire }]
    const result = await computeCumulativeBonusBatch(employees, anchor)
    expect(result.get('u1')!.cleanStreak).toBe(4)
  })

  it('returns empty map for empty input', async () => {
    const result = await computeCumulativeBonusBatch([], new Date())
    expect(result.size).toBe(0)
    expect(dbMock.transaction.findMany).not.toHaveBeenCalled()
  })

  it('breaks streak when a delay is logged (delayLimit=0)', async () => {
    const anchor = dateAt(2026, 6, 7)
    const dirtyWeek = new Date(anchor); dirtyWeek.setDate(anchor.getDate() - 21) // -3w
    dbMock.transaction.findMany.mockResolvedValueOnce([
      {
        handledByUserId: 'u1',
        txDateTime: new Date(dirtyWeek.getTime() + 1000),
        reviewCategory: null,
        currency: 'USD',
        amount: 0,
        hasDelay: true,
      },
    ])
    const employees = [
      { id: 'u1', hireDate: dateAt(2020, 1, 1), createdAt: dateAt(2020, 1, 1) },
    ]
    const result = await computeCumulativeBonusBatch(employees, anchor)
    expect(result.get('u1')!.cleanStreak).toBe(3)
  })
})
