import { describe, it, expect } from 'vitest'
import {
  shiftDateKey,
  buildPlannedMatrix,
  derivePlannedFields,
  type PlannedShiftRow,
} from '@/lib/attendance/planned'

// A week's worth of YYYY-MM-DD day strings (Sun May 10 2026 → Sat May 16).
const WEEK_DAYS = [
  '2026-05-10', '2026-05-11', '2026-05-12', '2026-05-13',
  '2026-05-14', '2026-05-15', '2026-05-16',
]

describe('shiftDateKey', () => {
  it('slices a YYYY-MM-DD string as-is', () => {
    expect(shiftDateKey('2026-05-12')).toBe('2026-05-12')
  })

  it('slices a Date (UTC-midnight @db.Date) to its calendar day', () => {
    expect(shiftDateKey(new Date('2026-05-12T00:00:00.000Z'))).toBe('2026-05-12')
  })
})

describe('buildPlannedMatrix', () => {
  it('places each planned shift in the right user row + day slot', () => {
    const rows: PlannedShiftRow[] = [
      { userId: 'u1', date: '2026-05-10', shiftNumber: 'ONE', isDayOff: false },
      { userId: 'u1', date: '2026-05-12', shiftNumber: 'ONE', isDayOff: true },
      { userId: 'u2', date: '2026-05-11', shiftNumber: 'TWO', isDayOff: false },
    ]
    const m = buildPlannedMatrix(rows, ['u1', 'u2'], WEEK_DAYS)
    expect(m.get('u1')![0]).toEqual({ shiftNumber: 'ONE', isDayOff: false })
    expect(m.get('u1')![2]).toEqual({ shiftNumber: 'ONE', isDayOff: true })
    expect(m.get('u1')![1]).toBeUndefined()
    expect(m.get('u2')![1]).toEqual({ shiftNumber: 'TWO', isDayOff: false })
  })

  it('accepts Date-typed shift dates (Prisma @db.Date)', () => {
    const rows: PlannedShiftRow[] = [
      { userId: 'u1', date: new Date('2026-05-14T00:00:00.000Z'), shiftNumber: 'THREE', isDayOff: false },
    ]
    const m = buildPlannedMatrix(rows, ['u1'], WEEK_DAYS)
    expect(m.get('u1')![4]).toEqual({ shiftNumber: 'THREE', isDayOff: false })
  })

  it('every listed user gets a 7-slot row even with no shifts', () => {
    const m = buildPlannedMatrix([], ['u1', 'u2'], WEEK_DAYS)
    expect(m.get('u1')).toHaveLength(7)
    expect(m.get('u2')!.every(c => c === undefined)).toBe(true)
  })

  it('ignores shifts for users not in the attendance view', () => {
    const rows: PlannedShiftRow[] = [
      { userId: 'stranger', date: '2026-05-10', shiftNumber: 'ONE', isDayOff: false },
    ]
    const m = buildPlannedMatrix(rows, ['u1'], WEEK_DAYS)
    expect(m.has('stranger')).toBe(false)
    expect(m.get('u1')!.every(c => c === undefined)).toBe(true)
  })

  it('ignores shifts whose date falls outside the displayed week', () => {
    const rows: PlannedShiftRow[] = [
      { userId: 'u1', date: '2026-05-03', shiftNumber: 'ONE', isDayOff: false }, // week before
      { userId: 'u1', date: '2026-05-20', shiftNumber: 'TWO', isDayOff: false }, // week after
    ]
    const m = buildPlannedMatrix(rows, ['u1'], WEEK_DAYS)
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
