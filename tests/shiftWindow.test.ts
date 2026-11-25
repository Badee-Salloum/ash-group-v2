import { describe, it, expect } from 'vitest'
import {
  previousShift,
  previousShiftIsPriorDay,
  isWithinCheckinWindow,
  checkinWindowUtc,
} from '@/lib/shifts/shiftWindow'
import { damascusMinutesOfDay } from '@/lib/datetime'

describe('previousShift', () => {
  it('TWO ← ONE, THREE ← TWO, ONE ← THREE', () => {
    expect(previousShift('TWO')).toBe('ONE')
    expect(previousShift('THREE')).toBe('TWO')
    expect(previousShift('ONE')).toBe('THREE')
  })
  it('only ONE takes its predecessor from the prior calendar day', () => {
    expect(previousShiftIsPriorDay('ONE')).toBe(true)
    expect(previousShiftIsPriorDay('TWO')).toBe(false)
    expect(previousShiftIsPriorDay('THREE')).toBe(false)
  })
})

describe('damascusMinutesOfDay', () => {
  it('06:15 Damascus = 375 minutes', () => {
    // 2026-05-14 03:15 UTC = 06:15 +03:00
    expect(damascusMinutesOfDay(new Date('2026-05-14T03:15:00Z'))).toBe(6 * 60 + 15)
  })
  it('Damascus midnight = 0 minutes', () => {
    // 2026-05-13 21:00 UTC = 2026-05-14 00:00 +03:00
    expect(damascusMinutesOfDay(new Date('2026-05-13T21:00:00Z'))).toBe(0)
  })
})

describe('isWithinCheckinWindow — grace 60min', () => {
  it('ONE: open 05:00..14:00', () => {
    expect(isWithinCheckinWindow('ONE', 5 * 60)).toBe(true)   // 05:00 exactly
    expect(isWithinCheckinWindow('ONE', 5 * 60 - 1)).toBe(false) // 04:59
    expect(isWithinCheckinWindow('ONE', 14 * 60)).toBe(true)  // 14:00
    expect(isWithinCheckinWindow('ONE', 14 * 60 + 1)).toBe(false)
  })
  it('TWO: open 13:00..22:00', () => {
    expect(isWithinCheckinWindow('TWO', 13 * 60)).toBe(true)
    expect(isWithinCheckinWindow('TWO', 12 * 60 + 59)).toBe(false)
    expect(isWithinCheckinWindow('TWO', 22 * 60)).toBe(true)
  })
  it('THREE: wraps — open 21:00..06:00 next day', () => {
    expect(isWithinCheckinWindow('THREE', 21 * 60)).toBe(true)   // 21:00
    expect(isWithinCheckinWindow('THREE', 23 * 60)).toBe(true)   // 23:00
    expect(isWithinCheckinWindow('THREE', 0)).toBe(true)          // 00:00
    expect(isWithinCheckinWindow('THREE', 6 * 60)).toBe(true)     // 06:00
    expect(isWithinCheckinWindow('THREE', 6 * 60 + 1)).toBe(false) // 06:01
    expect(isWithinCheckinWindow('THREE', 20 * 60 + 59)).toBe(false) // 20:59
  })
})

describe('checkinWindowUtc', () => {
  it('ONE on 2026-05-14 → [05:00, 14:00] Damascus as UTC', () => {
    const w = checkinWindowUtc('2026-05-14', 'ONE')
    // 05:00 +03:00 = 02:00 UTC; 14:00 +03:00 = 11:00 UTC
    expect(w.openFrom.toISOString()).toBe('2026-05-14T02:00:00.000Z')
    expect(w.end.toISOString()).toBe('2026-05-14T11:00:00.000Z')
  })
  it('THREE on 2026-05-14 → end rolls into the next calendar day', () => {
    const w = checkinWindowUtc('2026-05-14', 'THREE')
    // open 21:00 +03:00 = 18:00 UTC same day; end 06:00 next day +03:00 = 03:00 UTC
    expect(w.openFrom.toISOString()).toBe('2026-05-14T18:00:00.000Z')
    expect(w.end.toISOString()).toBe('2026-05-15T03:00:00.000Z')
  })
  it('a 23:00 Damascus check-in falls inside a same-day THREE window', () => {
    const w = checkinWindowUtc('2026-05-14', 'THREE')
    const now = new Date('2026-05-14T20:00:00Z').getTime() // 23:00 Damascus
    expect(now >= w.openFrom.getTime() && now <= w.end.getTime()).toBe(true)
  })
  it('a 02:00 Damascus check-in falls inside the PRIOR day\'s THREE window', () => {
    const w = checkinWindowUtc('2026-05-14', 'THREE')
    const now = new Date('2026-05-14T23:00:00Z').getTime() // 02:00 next day Damascus
    expect(now >= w.openFrom.getTime() && now <= w.end.getTime()).toBe(true)
  })
})
