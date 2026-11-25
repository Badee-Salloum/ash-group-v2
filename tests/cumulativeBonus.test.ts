import { describe, it, expect, vi, beforeEach } from 'vitest'

// The new streak walker calls three queries per week:
//   * db.transaction.count with a handled-count where
//   * db.transaction.groupBy with reviewCategory in RESET_CATEGORIES
//   * db.transaction.count with hasDelay=true
// The mock recognizes which query is being made by inspecting the where
// clause. Legacy scenarios describe weeks as "dirty" via a plain error
// count on that week.
const { dbMock, weekErrorPlan } = vi.hoisted(() => {
  const errorPlan: number[] = []
  return {
    dbMock: {
      transaction: {
        count: vi.fn(async (args: { where: Record<string, unknown> }) => {
          const w = args.where as Record<string, unknown>
          if ('hasDelay' in w) return 0
          // Not a delay query → treat as "handled count" (positive so ratio
          // works). 1000 handled × 0 errors keeps the ratio at 0.
          return 1000
        }),
        groupBy: vi.fn(async () => {
          const errs = errorPlan.shift() ?? 0
          if (errs <= 0) return []
          // A single-currency group so the amount check doesn't fire.
          return [{ currency: 'USD', _count: { _all: errs }, _sum: { amount: 0 } }]
        }),
        findMany: vi.fn(async () => []),
      },
    },
    weekErrorPlan: errorPlan,
  }
})

vi.mock('@/lib/db/client', () => ({ db: dbMock }))
vi.mock('@/lib/settings/global', () => ({
  getPayrollEpochStart: vi.fn(async () => '2000-01-02'),
  getBonusThresholds: vi.fn(async () => ({
    // Very permissive limits — the streak breaks only when errorCount > 0
    // (any error in a week whose handledCount is at most 1000 pushes ratio
    // above 0). Amount limit is Infinity via the empty map lookup.
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
  computeCumulativeBonus,
  CUMULATIVE_PER_WEEK,
  MAX_LOOKBACK_WEEKS,
} from '@/lib/compensation/cumulativeBonus'

function dateAt(year: number, month: number, day: number) {
  const d = new Date(year, month - 1, day)
  d.setHours(0, 0, 0, 0)
  return d
}

describe('computeCumulativeBonus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    weekErrorPlan.length = 0
  })

  it('returns zero streak when current week has errors', async () => {
    weekErrorPlan.push(2) // anchor week dirty
    const anchor = dateAt(2026, 6, 7)
    const employee = {
      id: 'u1',
      hireDate: dateAt(2024, 1, 1),
      createdAt: dateAt(2024, 1, 1),
    }
    const result = await computeCumulativeBonus(employee, anchor)
    expect(result.cleanStreak).toBe(0)
    expect(result.amount).toBe(0)
    expect(result.lastErrorWeek).not.toBeNull()
  })

  it('accumulates over many clean weeks up to MAX_LOOKBACK_WEEKS', async () => {
    // All lookback weeks clean.
    const anchor = dateAt(2026, 6, 7)
    const employee = {
      id: 'u1',
      hireDate: dateAt(2020, 1, 1),
      createdAt: dateAt(2020, 1, 1),
    }
    const result = await computeCumulativeBonus(employee, anchor)
    expect(result.cleanStreak).toBe(MAX_LOOKBACK_WEEKS)
    expect(result.amount).toBe(MAX_LOOKBACK_WEEKS * CUMULATIVE_PER_WEEK)
    expect(result.lastErrorWeek).toBeNull()
  })

  it('breaks streak on first dirty week and reports lastErrorWeek', async () => {
    weekErrorPlan.push(0, 0, 0, 1) // anchor, -1, -2 clean, -3 dirty
    const anchor = dateAt(2026, 6, 7)
    const employee = {
      id: 'u1',
      hireDate: dateAt(2020, 1, 1),
      createdAt: dateAt(2020, 1, 1),
    }
    const result = await computeCumulativeBonus(employee, anchor)
    expect(result.cleanStreak).toBe(3)
    expect(result.amount).toBe(3 * CUMULATIVE_PER_WEEK)
    expect(result.lastErrorWeek).not.toBeNull()
  })

  it('respects hire-date boundary (no phantom history before hire)', async () => {
    const anchor = dateAt(2026, 6, 7)
    const hireDate = new Date(anchor); hireDate.setDate(anchor.getDate() - 7 * 3 - 3)
    const employee = {
      id: 'u1',
      hireDate,
      createdAt: hireDate,
    }
    const result = await computeCumulativeBonus(employee, anchor)
    expect(result.cleanStreak).toBe(4)
    expect(result.amount).toBe(4 * CUMULATIVE_PER_WEEK)
  })

  it('excludes anchor week when includeAnchorWeek=false (payroll mode)', async () => {
    weekErrorPlan.push(0, 0, 1) // -1, -2 clean, -3 dirty
    const anchor = dateAt(2026, 6, 7)
    const employee = {
      id: 'u1',
      hireDate: dateAt(2020, 1, 1),
      createdAt: dateAt(2020, 1, 1),
    }
    const result = await computeCumulativeBonus(employee, anchor, { includeAnchorWeek: false })
    expect(result.cleanStreak).toBe(2)
    expect(result.amount).toBe(2 * CUMULATIVE_PER_WEEK)
  })
})
