import { describe, it, expect } from 'vitest'
import { generateWeeklySchedule, type Employee } from '@/lib/schedule/generator'

// Anchor on a known Sunday so dayOffset 0 = Sunday in our outputs.
const SUNDAY = new Date(2026, 4, 10) // May 10 2026, a Sunday in local time

function emp(id: string, fixedOffDay: number | null = null): Employee {
  return { id, fixedOffDay }
}

describe('generateWeeklySchedule — shift continuity', () => {
  it('each employee is on the same shift number every day of the week', () => {
    const employees = ['a', 'b', 'c', 'd', 'e', 'f'].map(i => emp(i))
    const r = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 1 })

    const byUser = new Map<string, Set<string>>()
    for (const s of r.shifts) {
      if (!byUser.has(s.userId)) byUser.set(s.userId, new Set())
      byUser.get(s.userId)!.add(s.shiftNumber)
    }
    for (const [uid, shifts] of byUser) {
      expect(shifts.size, `${uid} should stay on one shift`).toBe(1)
    }
  })

  it('round-robin: employees[0]→ONE, [1]→TWO, [2]→THREE, [3]→ONE...', () => {
    const employees = ['a', 'b', 'c', 'd'].map(i => emp(i))
    const r = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 1 })
    expect(r.assignments['a']).toBe('ONE')
    expect(r.assignments['b']).toBe('TWO')
    expect(r.assignments['c']).toBe('THREE')
    expect(r.assignments['d']).toBe('ONE')
  })
})

describe('generateWeeklySchedule — fixed off-day', () => {
  it('null off-day = employee works every day', () => {
    const employees = ['a', 'b', 'c'].map(i => emp(i, null))
    const r = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 1 })
    expect(r.shifts.every(s => !s.isDayOff)).toBe(true)
  })

  it('fixedOffDay:0 (Sunday) → exactly Sunday is off for that user', () => {
    // minPerShift=0 so the generator doesn't force the single user in each
    // shift to work through their off-day.
    const employees = [emp('a', 0), emp('b', 1), emp('c', 2)]
    const r = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 0 })
    const offA = r.shifts.filter(s => s.userId === 'a' && s.isDayOff)
    expect(offA.length).toBe(1)
    const off = offA[0]
    // The off-day should be Sunday, i.e. the very first date in the week.
    expect(off.date.slice(-2)).toBe('10') // May 10 2026
  })
})

describe('generateWeeklySchedule — determinism', () => {
  it('same input produces byte-identical output', () => {
    const employees = ['z', 'a', 'm'].map(i => emp(i, 3))
    const r1 = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 1 })
    const r2 = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 1 })
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
  })
})
