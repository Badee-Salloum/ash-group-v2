import { describe, it, expect } from 'vitest'
import { damascusDateStr } from '@/lib/datetime'

// Regression for the off-by-one daysWorked bug.
//
// Sessions starting in Damascus local time between 00:00 and 03:00 fell on
// the previous UTC calendar day when keyed by `toISOString().slice(0,10)`,
// so an employee who worked 7 distinct calendar days was credited with 6.
// The payroll route now uses `damascusDateStr(startAt)` instead, which
// formats in Asia/Damascus (UTC+3).
describe('daysWorked anchors on local Damascus date, not UTC', () => {
  it('1:30 AM Damascus session is credited to that day', () => {
    // 2026-06-13 01:30 Damascus (UTC+3) = 2026-06-12 22:30 UTC.
    const startAt = new Date('2026-06-12T22:30:00.000Z')
    expect(damascusDateStr(startAt)).toBe('2026-06-13')
    expect(startAt.toISOString().slice(0, 10)).toBe('2026-06-12')
  })

  it('7 distinct local days resolve to 7 entries (not 6)', () => {
    const sessions = [
      // Each session starts in the early local morning (after midnight
      // Damascus but before midnight UTC of the same day).
      new Date('2026-06-06T22:00:00.000Z'), // Sat
      new Date('2026-06-07T22:30:00.000Z'), // Sun
      new Date('2026-06-08T22:00:00.000Z'), // Mon
      new Date('2026-06-09T22:00:00.000Z'), // Tue
      new Date('2026-06-10T22:00:00.000Z'), // Wed
      new Date('2026-06-11T22:00:00.000Z'), // Thu
      new Date('2026-06-12T22:30:00.000Z'), // Fri
    ]
    const localDays = new Set(sessions.map(s => damascusDateStr(s)))
    expect(localDays.size).toBe(7)
    // The naive UTC bucketing buggy code shows 7 too but they're shifted —
    // make sure the local strings land on Sun..Sat 2026-06-07..2026-06-13.
    expect(Array.from(localDays).sort()).toEqual([
      '2026-06-07', '2026-06-08', '2026-06-09', '2026-06-10',
      '2026-06-11', '2026-06-12', '2026-06-13',
    ])
  })

  it('an evening session and an early-morning next-day session are 2 different days', () => {
    // 23:00 local on day X and 01:00 local on day X+1 — they straddle local
    // midnight, so should count as 2 distinct days.
    const evening = new Date('2026-06-13T20:00:00.000Z')   // 23:00 Damascus
    const earlyMorning = new Date('2026-06-13T22:00:00.000Z') // 01:00 next day Damascus
    expect(damascusDateStr(evening)).toBe('2026-06-13')
    expect(damascusDateStr(earlyMorning)).toBe('2026-06-14')
  })
})
