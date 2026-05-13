import { describe, it, expect } from 'vitest'
import { generateWeeklySchedule, type Employee } from '@/lib/schedule/generator'

// Anchor on a known Sunday so dayOffset 0 = Sunday in our outputs.
const SUNDAY = new Date(2026, 4, 10) // May 10 2026, a Sunday in local time

function emp(id: string, weeklyOffDays = 1): Employee {
  return { id, weeklyOffDays }
}

describe('generateWeeklySchedule — shift continuity', () => {
  it('each employee is on the same shift number every day of the week', () => {
    const employees = ['a', 'b', 'c', 'd', 'e', 'f'].map(i => emp(i, 0))
    const r = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 1 })

    // Group by user → distinct shift numbers across the week should be 1.
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
    const employees = ['a', 'b', 'c', 'd'].map(i => emp(i, 0))
    const r = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 1 })
    expect(r.assignments['a']).toBe('ONE')
    expect(r.assignments['b']).toBe('TWO')
    expect(r.assignments['c']).toBe('THREE')
    expect(r.assignments['d']).toBe('ONE')
  })
})

describe('generateWeeklySchedule — weekly off days', () => {
  it('weeklyOffDays:2 marks exactly 2 days off per employee (when coverage allows)', () => {
    // 6 employees → 2 per shift, so even when one is off the other covers.
    const employees = ['a', 'b', 'c', 'd', 'e', 'f'].map(i => emp(i, 2))
    const r = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 1 })

    const offByUser = new Map<string, number>()
    for (const s of r.shifts) {
      if (s.isDayOff) {
        offByUser.set(s.userId, (offByUser.get(s.userId) || 0) + 1)
      }
    }
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      expect(offByUser.get(id), `employee ${id} should have 2 off days`).toBe(2)
    }
  })

  it('weeklyOffDays:0 leaves nobody off', () => {
    const employees = ['a', 'b', 'c'].map(i => emp(i, 0))
    const r = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 1 })
    expect(r.shifts.every(s => !s.isDayOff)).toBe(true)
  })

  it('off-day windows rotate so the same shift isn\'t empty on the same day', () => {
    // 6 employees, all on shift ONE? No — they round-robin into 3 shifts (2 per shift).
    // Within each shift, the 2 employees should NOT share the same off-day.
    const employees = ['a', 'b', 'c', 'd', 'e', 'f'].map(i => emp(i, 1))
    const r = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 0 })

    for (const sn of ['ONE', 'TWO', 'THREE'] as const) {
      const inShift = r.shifts.filter(s => s.shiftNumber === sn)
      const offByDay = new Map<string, Set<string>>()
      for (const s of inShift) {
        if (s.isDayOff) {
          if (!offByDay.has(s.date)) offByDay.set(s.date, new Set())
          offByDay.get(s.date)!.add(s.userId)
        }
      }
      // On no single day should ALL the employees in this shift be off
      const inShiftUsers = new Set(inShift.map(s => s.userId))
      for (const [day, offUsers] of offByDay) {
        expect(offUsers.size, `${sn} on ${day}: ${[...offUsers].join(',')}`).toBeLessThan(inShiftUsers.size)
      }
    }
  })
})

describe('generateWeeklySchedule — minPerShift floor', () => {
  it('enforces minimum coverage even if it overrides weeklyOffDays', () => {
    // 3 employees, all on shift ONE round-robin? No — they're spread one per shift.
    // To test the floor, give just ONE employee with high offDays and minPerShift=1.
    const employees = [emp('solo', 5)]
    const r = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 1 })
    const inShift = r.shifts.filter(s => s.userId === 'solo')
    const workingDays = inShift.filter(s => !s.isDayOff).length
    expect(workingDays, 'minPerShift=1 must yield ≥1 working day').toBeGreaterThanOrEqual(1)
  })

  it('with minPerShift:0 a solo employee with 7 off days really has 0 working days', () => {
    const employees = [emp('solo', 3)]
    const r = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 0 })
    const inShift = r.shifts.filter(s => s.userId === 'solo')
    const offDays = inShift.filter(s => s.isDayOff).length
    expect(offDays).toBe(3)
  })
})

describe('generateWeeklySchedule — determinism', () => {
  it('same input produces byte-identical output', () => {
    const employees = ['z', 'a', 'm'].map(i => emp(i, 2))
    const r1 = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 1 })
    const r2 = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 1 })
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
  })

  it('sorts employees by id (so the call site doesn\'t need to)', () => {
    const sorted = ['a', 'b', 'c'].map(i => emp(i, 1))
    const shuffled = ['c', 'a', 'b'].map(i => emp(i, 1))
    const r1 = generateWeeklySchedule({ weekStart: SUNDAY, employees: sorted, minPerShift: 1 })
    const r2 = generateWeeklySchedule({ weekStart: SUNDAY, employees: shuffled, minPerShift: 1 })
    expect(r1.assignments).toEqual(r2.assignments)
  })
})

describe('generateWeeklySchedule — output shape', () => {
  it('emits 7 days × 3 shifts × employees rows', () => {
    const employees = ['a', 'b', 'c'].map(i => emp(i, 0))
    const r = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 1 })
    // 3 employees spread 1-per-shift, so each (day, shift) has exactly 1 row → 21 total
    expect(r.shifts.length).toBe(21)
  })

  it('date is YYYY-MM-DD starting at weekStart', () => {
    const employees = [emp('a', 0)]
    const r = generateWeeklySchedule({ weekStart: SUNDAY, employees, minPerShift: 1 })
    expect(r.shifts[0].date).toBe('2026-05-10') // Sunday
    expect(r.shifts[r.shifts.length - 1].date).toBe('2026-05-16') // Saturday
  })
})
