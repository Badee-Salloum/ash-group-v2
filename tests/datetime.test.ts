import { describe, it, expect } from 'vitest'
import {
  fmtSyria, fmtSyriaDate, startOfWeek, endOfWeek,
  dayOfWeek, addDays, weekStartStr, weekDays, damascusDayStartUtc, damascusDateStr,
} from '@/lib/datetime'

describe('startOfWeek — Sunday-aligned', () => {
  it('returns same date at 00:00:00 when given a Sunday', () => {
    const sun = new Date('2026-04-26T15:30:00')
    const ws = startOfWeek(sun)
    expect(ws.getDay()).toBe(0)
    expect(ws.getHours()).toBe(0)
    expect(ws.getMinutes()).toBe(0)
    expect(ws.getSeconds()).toBe(0)
    expect(ws.getDate()).toBe(26)
  })

  it('returns prior Sunday when given a Wednesday', () => {
    const wed = new Date('2026-04-29T10:00:00')
    const ws = startOfWeek(wed)
    expect(ws.getDay()).toBe(0)
    expect(ws.getDate()).toBe(26)
  })

  it('accepts ISO string input', () => {
    const ws = startOfWeek('2026-04-29')
    expect(ws.getDay()).toBe(0)
  })
})

describe('endOfWeek', () => {
  it('returns Saturday 23:59:59.999 of the same week', () => {
    const we = endOfWeek(new Date('2026-04-26T00:00:00'))
    expect(we.getDay()).toBe(6) // Saturday
    expect(we.getHours()).toBe(23)
    expect(we.getMinutes()).toBe(59)
    expect(we.getSeconds()).toBe(59)
    expect(we.getMilliseconds()).toBe(999)
  })

  it('endOfWeek - startOfWeek = ~7 days minus 1 ms', () => {
    const ws = startOfWeek(new Date('2026-04-26'))
    const we = endOfWeek(new Date('2026-04-26'))
    const diffMs = we.getTime() - ws.getTime()
    // 7 days = 604,800,000 ms; subtract 1 ms because we ends at 23:59:59.999
    expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000 - 1)
  })
})

describe('fmtSyria / fmtSyriaDate — Damascus timezone', () => {
  it('fmtSyriaDate returns YYYY-MM-DD for a Date', () => {
    expect(fmtSyriaDate(new Date('2026-04-28T10:00:00+03:00'))).toBe('2026-04-28')
  })

  it('fmtSyriaDate handles ISO string', () => {
    expect(fmtSyriaDate('2026-04-28T10:00:00+03:00')).toBe('2026-04-28')
  })

  it('fmtSyria includes time HH:MM:SS', () => {
    const out = fmtSyria(new Date('2026-04-28T19:24:22+03:00'))
    expect(out).toBe('2026-04-28 19:24:22')
  })

  it('fmtSyria without seconds when withSeconds=false', () => {
    const out = fmtSyria(new Date('2026-04-28T19:24:22+03:00'), false)
    expect(out).toBe('2026-04-28 19:24')
  })

  it('returns "—" for invalid date', () => {
    expect(fmtSyria('not-a-date')).toBe('—')
    expect(fmtSyriaDate('not-a-date')).toBe('—')
  })

  it('renders UTC midnight as Syria 03:00 (+03:00 offset)', () => {
    // 2026-04-28 00:00 UTC = 2026-04-28 03:00 Damascus
    expect(fmtSyria('2026-04-28T00:00:00Z')).toBe('2026-04-28 03:00:00')
  })
})

// ─── Timezone-stable calendar-week helpers ──────────────────────────────────
// These guard against the bug where toISOString().slice(0,10) after a local
// setHours() shifts the date backward a day in UTC+3.

describe('dayOfWeek', () => {
  it('May 10 2026 is a Sunday (0)', () => {
    expect(dayOfWeek('2026-05-10')).toBe(0)
  })
  it('May 9 2026 is a Saturday (6) — not Sunday', () => {
    // This is the exact off-by-one the old code got wrong.
    expect(dayOfWeek('2026-05-09')).toBe(6)
  })
  it('covers a full week 0..6', () => {
    expect([10, 11, 12, 13, 14, 15, 16].map(d => dayOfWeek(`2026-05-${d}`)))
      .toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})

describe('addDays', () => {
  it('adds days within a month', () => {
    expect(addDays('2026-05-10', 5)).toBe('2026-05-15')
  })
  it('subtracts days', () => {
    expect(addDays('2026-05-10', -3)).toBe('2026-05-07')
  })
  it('crosses a month boundary', () => {
    expect(addDays('2026-05-30', 5)).toBe('2026-06-04')
  })
  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('weekStartStr', () => {
  it('a Sunday maps to itself (idempotent)', () => {
    expect(weekStartStr('2026-05-10')).toBe('2026-05-10')
  })
  it('a mid-week date maps back to its Sunday', () => {
    expect(weekStartStr('2026-05-14')).toBe('2026-05-10') // Thu → Sun
  })
  it('a Saturday maps back to the prior Sunday', () => {
    expect(weekStartStr('2026-05-16')).toBe('2026-05-10')
  })
  it('accepts a Date and returns its Damascus week-start', () => {
    // 2026-05-14 06:00 Damascus → still in the May-10 week
    expect(weekStartStr(new Date('2026-05-14T06:00:00+03:00'))).toBe('2026-05-10')
  })
})

describe('weekDays', () => {
  it('returns 7 consecutive day strings starting on the Sunday', () => {
    expect(weekDays('2026-05-10')).toEqual([
      '2026-05-10', '2026-05-11', '2026-05-12', '2026-05-13',
      '2026-05-14', '2026-05-15', '2026-05-16',
    ])
  })
  it('normalizes a mid-week input to the week-start first', () => {
    expect(weekDays('2026-05-14')[0]).toBe('2026-05-10')
  })
})

describe('damascusDayStartUtc', () => {
  it('00:00 Damascus is 21:00 UTC the previous day', () => {
    expect(damascusDayStartUtc('2026-05-10').toISOString()).toBe('2026-05-09T21:00:00.000Z')
  })
  it('a session at 06:15 Damascus falls on/after the day start', () => {
    const dayStart = damascusDayStartUtc('2026-05-14')
    const session = new Date('2026-05-14T06:15:00+03:00')
    expect(session.getTime()).toBeGreaterThan(dayStart.getTime())
  })
})

describe('damascusDateStr — session bucketing', () => {
  it('a 06:15 Damascus session buckets to its Damascus calendar day', () => {
    // 2026-05-14 06:15 +03:00 = 2026-05-14 03:15 UTC — still May 14 in Damascus
    expect(damascusDateStr(new Date('2026-05-14T03:15:00Z'))).toBe('2026-05-14')
  })
  it('a 00:48 Damascus session buckets to that same day, not the day before', () => {
    // 2026-05-14 00:48 +03:00 = 2026-05-13 21:48 UTC — but it is May 14 in Damascus
    expect(damascusDateStr(new Date('2026-05-13T21:48:00Z'))).toBe('2026-05-14')
  })
})
