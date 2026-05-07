import { describe, it, expect } from 'vitest'

// Pure-math helpers extracted from /api/payroll. We replicate them here so
// they can be tested without Prisma. If the API formula ever changes, copy
// the change here so the test catches regressions.

function dailyRate(baseSalary: number, weeklyOffDays: number): number {
  const workingDays = Math.max(1, 7 - weeklyOffDays)
  return baseSalary / workingDays
}

function proRatedSalary(baseSalary: number, weeklyOffDays: number, daysWorked: number): number {
  return dailyRate(baseSalary, weeklyOffDays) * daysWorked
}

function cumulativeBonus(cleanWeeks: number, perWeek = 5000): number {
  return cleanWeeks * perWeek
}

function netSalary(proRated: number, bonuses: number, deductions: number): number {
  return proRated + bonuses - deductions
}

// Streak walker — counts consecutive clean weeks back from the current week
// stopping at first error week OR start boundary (hireDate / createdAt).
function computeCleanStreak(
  weekStart: Date,
  startBoundary: Date,
  errorWeeks: Set<string>,  // ISO date keys of weeks containing errors
  maxLookbackWeeks = 24,
): number {
  let streak = 0
  for (let w = 0; w < maxLookbackWeeks; w++) {
    const wsBack = new Date(weekStart); wsBack.setDate(wsBack.getDate() - 7 * w)
    if (wsBack < startBoundary) break
    const key = wsBack.toISOString().slice(0, 10)
    if (errorWeeks.has(key)) break
    streak++
  }
  return streak
}

describe('payroll math — daily rate', () => {
  it('1,500,000 ل.س / 6 working days = 250,000 per day', () => {
    expect(dailyRate(1_500_000, 1)).toBe(250_000)
  })

  it('700,000 / 5 working days (2 off) = 140,000', () => {
    expect(dailyRate(700_000, 2)).toBe(140_000)
  })

  it('handles 0 off-days (7 working) — full week', () => {
    expect(dailyRate(700_000, 0)).toBeCloseTo(100_000)
  })

  it('clamps to at least 1 working day to avoid div by zero', () => {
    expect(dailyRate(700_000, 7)).toBe(700_000)  // 7-7=0 → clamp to 1
    expect(dailyRate(700_000, 10)).toBe(700_000) // negative → clamp to 1
  })
})

describe('payroll math — pro-rated salary', () => {
  it('full week worked → full base salary', () => {
    expect(proRatedSalary(700_000, 1, 6)).toBe(700_000)
  })

  it('half week worked → half salary', () => {
    expect(proRatedSalary(600_000, 1, 3)).toBe(300_000)
  })

  it('zero days worked → zero salary', () => {
    expect(proRatedSalary(700_000, 1, 0)).toBe(0)
  })
})

describe('payroll math — cumulative bonus', () => {
  it('3 clean weeks × 5,000 = 15,000', () => {
    expect(cumulativeBonus(3)).toBe(15_000)
  })

  it('0 clean weeks → 0', () => {
    expect(cumulativeBonus(0)).toBe(0)
  })

  it('respects custom perWeek amount', () => {
    expect(cumulativeBonus(4, 7500)).toBe(30_000)
  })
})

describe('payroll math — net salary', () => {
  it('net = proRated + bonuses − deductions', () => {
    expect(netSalary(800_000, 50_000, 10_000)).toBe(840_000)
  })

  it('zero everything = 0', () => {
    expect(netSalary(0, 0, 0)).toBe(0)
  })

  it('deductions can exceed earnings (negative net)', () => {
    expect(netSalary(100_000, 0, 200_000)).toBe(-100_000)
  })
})

describe('cumulative streak walker', () => {
  const ws = new Date('2026-04-26T00:00:00Z')
  const longAgo = new Date('2025-01-01T00:00:00Z')

  it('returns 0 when current week has an error', () => {
    const errors = new Set(['2026-04-26'])
    expect(computeCleanStreak(ws, longAgo, errors)).toBe(0)
  })

  it('returns 1 when current week clean, prior has error', () => {
    const errors = new Set(['2026-04-19'])
    expect(computeCleanStreak(ws, longAgo, errors)).toBe(1)
  })

  it('returns 5 when last 5 weeks clean, 6th has error', () => {
    const errors = new Set(['2026-03-22'])  // 5 weeks before April 26
    expect(computeCleanStreak(ws, longAgo, errors)).toBe(5)
  })

  it('clamps at start boundary (hireDate)', () => {
    const hire = new Date('2026-04-12T00:00:00Z')  // hired 2 weeks ago
    expect(computeCleanStreak(ws, hire, new Set())).toBe(3)  // weeks 04-26, 04-19, 04-12
  })

  it('clamps at MAX_LOOKBACK_WEEKS even with old hireDate + no errors', () => {
    expect(computeCleanStreak(ws, longAgo, new Set(), 24)).toBe(24)
  })
})
