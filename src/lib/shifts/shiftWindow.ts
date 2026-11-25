// Shift clock windows + ordering. Single source of truth shared by the
// schedule generator, the handover suggester, and the check-in gate.
//
// The three shifts cover the 24h day:
//   ONE   06:00 → 14:00
//   TWO   14:00 → 22:00
//   THREE 22:00 → 06:00   (wraps past midnight)

import { damascusDayStartUtc } from '@/lib/datetime'

export type ShiftNumber = 'ONE' | 'TWO' | 'THREE'

interface Window {
  /** start minute-of-day (0..1439) */
  start: number
  /** end minute-of-day; for THREE this is < start because it wraps */
  end: number
}

export const SHIFT_WINDOWS: Record<ShiftNumber, Window> = {
  ONE: { start: 6 * 60, end: 14 * 60 },   // 360 → 840
  TWO: { start: 14 * 60, end: 22 * 60 },  // 840 → 1320
  THREE: { start: 22 * 60, end: 6 * 60 }, // 1320 → 360 (next day)
}

// Default grace before a shift starts during which check-in is already
// allowed (an employee may arrive early). Overridable via env.
export const DEFAULT_CHECKIN_GRACE_MIN = (() => {
  const raw = parseInt(process.env.CHECKIN_GRACE_MINUTES || '', 10)
  return Number.isFinite(raw) && raw >= 0 ? raw : 60
})()

// The shift that runs immediately before `sn`. The previous shift of ONE
// (06:00) is THREE — which belongs to the *prior calendar day*.
export function previousShift(sn: ShiftNumber): ShiftNumber {
  switch (sn) {
    case 'TWO': return 'ONE'
    case 'THREE': return 'TWO'
    case 'ONE': return 'THREE'
  }
}

// Does the previous shift belong to the prior calendar day? True only for ONE
// (whose previous shift THREE started the day before).
export function previousShiftIsPriorDay(sn: ShiftNumber): boolean {
  return sn === 'ONE'
}

// Is `nowMinutes` (minutes-of-day, Damascus) inside the check-in window for
// shift `sn`? The window is [start − grace, end]. Wrap-aware for THREE.
export function isWithinCheckinWindow(
  sn: ShiftNumber,
  nowMinutes: number,
  graceMin: number = DEFAULT_CHECKIN_GRACE_MIN,
): boolean {
  const w = SHIFT_WINDOWS[sn]
  // Normalize the early-grace start; it can go negative (wraps to prev day).
  const openFrom = (w.start - graceMin + 1440) % 1440
  const wraps = w.end <= w.start
  if (!wraps && graceMin <= w.start) {
    // Simple, non-wrapping window, grace doesn't cross midnight.
    return nowMinutes >= openFrom && nowMinutes <= w.end
  }
  // Wrapping window (THREE) OR grace pushed the open time before midnight.
  // The allowed range is openFrom..1439 plus 0..end.
  return nowMinutes >= openFrom || nowMinutes <= w.end
}

// Absolute check-in window for a specific scheduled shift, as UTC instants.
// `dateStr` is the shift's calendar day (YYYY-MM-DD, Damascus). For THREE the
// end rolls into the next calendar day. Use this to test a real timestamp:
//   const w = checkinWindowUtc(shift.date, shift.shiftNumber)
//   const ok = now >= w.openFrom && now <= w.end
export function checkinWindowUtc(
  dateStr: string,
  sn: ShiftNumber,
  graceMin: number = DEFAULT_CHECKIN_GRACE_MIN,
): { openFrom: Date; end: Date } {
  const dayStartMs = damascusDayStartUtc(dateStr).getTime()
  const w = SHIFT_WINDOWS[sn]
  const openFromMin = w.start - graceMin
  // THREE's end (06:00) belongs to the next calendar day → add 24h.
  const endMin = w.end <= w.start ? w.end + 1440 : w.end
  return {
    openFrom: new Date(dayStartMs + openFromMin * 60_000),
    end: new Date(dayStartMs + endMin * 60_000),
  }
}
