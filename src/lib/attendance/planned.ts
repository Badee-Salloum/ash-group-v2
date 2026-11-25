// Pure helpers for merging the planned roster (Shift rows) into the weekly
// attendance matrix. Extracted from the attendance route so the day-matching
// and planned/day-off derivation can be unit-tested without a database.
//
// Day matching is done by comparing YYYY-MM-DD calendar strings — never by
// millisecond arithmetic — so it is stable regardless of server timezone.

export interface PlannedShiftRow {
  userId: string
  date: Date | string
  shiftNumber: string
  isDayOff: boolean
}

export interface PlannedCell {
  shiftNumber: string
  isDayOff: boolean
}

// YYYY-MM-DD key for a Shift.date value. Shift.date is `@db.Date`, which
// Prisma returns as a Date at UTC midnight, so slicing the ISO string yields
// the correct calendar day without timezone math. Plain strings are sliced
// as-is.
export function shiftDateKey(date: Date | string): string {
  return typeof date === 'string'
    ? date.slice(0, 10)
    : date.toISOString().slice(0, 10)
}

// Build planned[userId] → array aligned to `weekDays` (one slot per day,
// `undefined` where nothing is scheduled).
export function buildPlannedMatrix(
  rows: PlannedShiftRow[],
  userIds: string[],
  weekDays: string[],
): Map<string, Array<PlannedCell | undefined>> {
  const planned = new Map<string, Array<PlannedCell | undefined>>()
  for (const id of userIds) {
    planned.set(id, Array.from({ length: weekDays.length }, () => undefined))
  }
  for (const r of rows) {
    const row = planned.get(r.userId)
    if (!row) continue // shift for a user not in this attendance view — ignore
    const idx = weekDays.indexOf(shiftDateKey(r.date))
    if (idx >= 0) {
      row[idx] = { shiftNumber: r.shiftNumber, isDayOff: r.isDayOff }
    }
  }
  return planned
}

// Derive the two fields the UI consumes from a planned cell.
//   - plannedShift: the shift number the employee is rostered for, or null
//     (null when nothing is scheduled OR the scheduled day is an off-day)
//   - plannedDayOff: true when the schedule explicitly marks a day off
export function derivePlannedFields(cell: PlannedCell | undefined): {
  plannedShift: string | null
  plannedDayOff: boolean
} {
  return {
    plannedShift: cell && !cell.isDayOff ? cell.shiftNumber : null,
    plannedDayOff: cell?.isDayOff ?? false,
  }
}
