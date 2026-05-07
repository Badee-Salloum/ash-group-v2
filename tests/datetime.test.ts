import { describe, it, expect } from 'vitest'
import { fmtSyria, fmtSyriaDate, startOfWeek, endOfWeek } from '@/lib/datetime'

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
