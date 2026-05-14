import { describe, it, expect } from 'vitest'
import {
  dayIndexOf,
  buildPlannedMatrix,
  derivePlannedFields,
  type PlannedShiftRow,
} from '@/lib/attendance/planned'

// Week anchored on a known Sunday.
const WEEK_START = new Date(2026, 4, 10) // Sun May 10 2026, local

describe('dayIndexOf', () => {
  it('maps weekStart itself to index 0', () => {
    expect(dayIndexOf(WEEK_START, WEEK_START)).toBe(0)
  })

  it('maps each day of the week to 0..6', () => {
    for (let i = 0; i < 7; i++) {
      const d = new Date(WEEK_START)
      d.setDate(WEEK_START.getDate() + i)
      expect(dayIndexOf(d, WEEK_START)).toBe(i)
    }
  })

  it('clamps a date before the week to 0', () => {
    const before = new Date(WEEK_START)
    before.setDate(WEEK_START.getDate() - 3)
    expect(dayIndexOf(before, WEEK_START)).toBe(0)
  })

  it('clamps a date after the week to 6', () => {
    const after = new Date(WEEK_START)
    after.setDate(WEEK_START.getDate() + 20)
    expect(dayIndexOf(after, WEEK_START)).toBe(6)
  })

  it('accepts ISO string dates', () => {
    expect(dayIndexOf('2026-05-12', WEEK_START)).toBe(2) // Tuesday
  })
})

describe('buildPlannedMatrix', () => {
  it('places each planned shift in the right user row + day slot', () => {
    const rows: PlannedShiftRow[] = [
      { userId: 'u1', date: '2026-05-10', shiftNumber: 'ONE', isDayOff: false },
      { userId: 'u1', date: '2026-05-12', shiftNumber: 'ONE', isDayOff: true },
      { userId: 'u2', date: '2026-05-11', shiftNumber: 'TWO', isDayOff: false },
    ]
    const m = buildPlannedMatrix(rows, ['u1', 'u2'], WEEK_START)
    expect(m.get('u1')![0]).toEqual({ shiftNumber: 'ONE', isDayOff: false })
    expect(m.get('u1')![2]).toEqual({ shiftNumber: 'ONE', isDayOff: true })
    expect(m.get('u1')![1]).toBeUndefined()
    expect(m.get('u2')![1]).toEqual({ shiftNumber: 'TWO', isDayOff: false })
  })

  it('every listed user gets a 7-slot row even with no shifts', () => {
    const m = buildPlannedMatrix([], ['u1', 'u2'], WEEK_START)
    expect(m.get('u1')).toHaveLength(7)
    expect(m.get('u2')!.every(c => c === undefined)).toBe(true)
  })

  it('ignores shifts for users not in the attendance view', () => {
    const rows: PlannedShiftRow[] = [
      { userId: 'stranger', date: '2026-05-10', shiftNumber: 'ONE', isDayOff: false },
    ]
    const m = buildPlannedMatrix(rows, ['u1'], WEEK_START)
    expect(m.has('stranger')).toBe(false)
    expect(m.get('u1')!.every(c => c === undefined)).toBe(true)
  })
})

describe('derivePlannedFields', () => {
  it('working planned cell → plannedShift set, plannedDayOff false', () => {
    expect(derivePlannedFields({ shiftNumber: 'TWO', isDayOff: false })).toEqual({
      plannedShift: 'TWO',
      plannedDayOff: false,
    })
  })

  it('day-off planned cell → plannedShift null, plannedDayOff true', () => {
    expect(derivePlannedFields({ shiftNumber: 'TWO', isDayOff: true })).toEqual({
      plannedShift: null,
      plannedDayOff: true,
    })
  })

  it('no planned cell → both empty', () => {
    expect(derivePlannedFields(undefined)).toEqual({
      plannedShift: null,
      plannedDayOff: false,
    })
  })
})
