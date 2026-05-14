// Pure helpers for merging the planned roster (Shift rows) into the weekly
// attendance matrix. Extracted from the attendance route so the day-indexing
// and planned/day-off derivation can be unit-tested without a database.

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

// Which day-of-week column (0..6) a date falls into, relative to weekStart.
// Clamped to [0,6] so a stray out-of-range date can't write past the array.
export function dayIndexOf(date: Date | string, weekStart: Date): number {
  const t = new Date(date).getTime()
  const raw = Math.floor((t - weekStart.getTime()) / 86_400_000)
  return Math.max(0, Math.min(6, raw))
}

// Build planned[userId] → 7-slot array of PlannedCell|undefined.
export function buildPlannedMatrix(
  rows: PlannedShiftRow[],
  userIds: string[],
  weekStart: Date,
): Map<string, Array<PlannedCell | undefined>> {
  const planned = new Map<string, Array<PlannedCell | undefined>>()
  for (const id of userIds) {
    planned.set(id, Array.from({ length: 7 }, () => undefined))
  }
  for (const r of rows) {
    const row = planned.get(r.userId)
    if (!row) continue // shift for a user not in this attendance view — ignore
    row[dayIndexOf(r.date, weekStart)] = {
      shiftNumber: r.shiftNumber,
      isDayOff: r.isDayOff,
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
