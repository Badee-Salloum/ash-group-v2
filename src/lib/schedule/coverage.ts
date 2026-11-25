// Phase F — coverage half-shift assignment. Pure logic.

import type { WalletGroup } from './walletGroups'

export type ShiftNum = 'ONE' | 'TWO' | 'THREE'

// Each 8h shift split into two 4h halves with explicit HH:MM ranges.
export const SHIFT_HALVES: Record<ShiftNum, { first: { start: string; end: string }; second: { start: string; end: string } }> = {
  ONE:   { first: { start: '06:00', end: '10:00' }, second: { start: '10:00', end: '14:00' } },
  TWO:   { first: { start: '14:00', end: '18:00' }, second: { start: '18:00', end: '22:00' } },
  THREE: { first: { start: '22:00', end: '02:00' }, second: { start: '02:00', end: '06:00' } },
}

// Rank used to pick who covers which half: an employee with an earlier own
// shift on the same day covers the first half (stays past their shift),
// the one with a later shift covers the second (comes in early).
const SHIFT_RANK: Record<ShiftNum, number> = { ONE: 1, TWO: 2, THREE: 3 }

export interface CoverableShift {
  id: string
  userId: string
  date: string  // YYYY-MM-DD
  shiftNumber: ShiftNum
  isDayOff: boolean
}

export interface LeaveRow {
  userId: string
  date: string  // YYYY-MM-DD
}

export interface CoverageEntry {
  date: string
  onLeaveUserId: string
  originalShiftId: string | null
  originalShiftNumber: ShiftNum
  walletIds: string[]
  firstHalf: { coverUserId: string; start: string; end: string }
  secondHalf: { coverUserId: string; start: string; end: string }
}

export interface CoverageWarn {
  date: string
  onLeaveUserId: string
  reason: string
}

export interface AssignInput {
  leaves: LeaveRow[]
  shifts: CoverableShift[]
  groups: WalletGroup[]
}

export interface AssignResult {
  entries: CoverageEntry[]
  warnings: CoverageWarn[]
}

// For each on-leave employee with a scheduled shift that day, find their
// wallet group, pick two other members as coverers, and split the 8h shift
// into two halves. Earlier-shift teammate gets the first half (extends
// hours forward), later-shift teammate gets the second (comes in early).
// Falls back to alphabetical order when both teammates lack a same-day
// shift or share the same shift number.
export function assignCoverage({ leaves, shifts, groups }: AssignInput): AssignResult {
  const entries: CoverageEntry[] = []
  const warnings: CoverageWarn[] = []

  // Index helpers.
  const groupForUser = new Map<string, WalletGroup>()
  for (const g of groups) {
    for (const e of g.employees) groupForUser.set(e.id, g)
  }
  // (userId, date) → shift number that day, for ranking teammates.
  const shiftByUserDate = new Map<string, CoverableShift>()
  for (const s of shifts) {
    if (s.isDayOff) continue
    shiftByUserDate.set(`${s.userId}|${s.date}`, s)
  }

  for (const lv of leaves) {
    const own = shiftByUserDate.get(`${lv.userId}|${lv.date}`)
    if (!own) {
      // No shift to cover — they were already off the schedule for that day.
      continue
    }
    const group = groupForUser.get(lv.userId)
    if (!group) {
      warnings.push({ date: lv.date, onLeaveUserId: lv.userId, reason: 'لا توجد مجموعة محافظ لهذا الموظف' })
      continue
    }
    const teammates = group.employees.filter(e => e.id !== lv.userId)
    if (teammates.length < 2) {
      warnings.push({ date: lv.date, onLeaveUserId: lv.userId, reason: `المجموعة فيها ${teammates.length + 1} موظف فقط — تحتاج ٣ للتغطية الكاملة` })
      continue
    }

    // Pick two coverers. Sort by their own shift rank that day (ascending),
    // with alphabetical name as tiebreaker. Then take the first two.
    const ranked = teammates
      .map(t => {
        const tshift = shiftByUserDate.get(`${t.id}|${lv.date}`)
        return { t, rank: tshift ? SHIFT_RANK[tshift.shiftNumber] : 99 }
      })
      .sort((a, b) => a.rank - b.rank || a.t.name.localeCompare(b.t.name, 'ar'))

    const firstCoverer = ranked[0].t
    const secondCoverer = ranked[1].t
    const halves = SHIFT_HALVES[own.shiftNumber]

    entries.push({
      date: lv.date,
      onLeaveUserId: lv.userId,
      originalShiftId: own.id,
      originalShiftNumber: own.shiftNumber,
      walletIds: group.walletIds,
      firstHalf: { coverUserId: firstCoverer.id, start: halves.first.start, end: halves.first.end },
      secondHalf: { coverUserId: secondCoverer.id, start: halves.second.start, end: halves.second.end },
    })
  }

  return { entries, warnings }
}

// Flatten CoverageEntry[] into the row-shape stored in CoverageAssignment.
// Returns one row per half (so each leave yields two rows).
export interface CoverageRow {
  userId: string
  date: string
  startTime: string
  endTime: string
  originalShiftId: string | null
  coverForUserId: string
}

export function entriesToRows(entries: CoverageEntry[]): CoverageRow[] {
  const rows: CoverageRow[] = []
  for (const e of entries) {
    rows.push({
      userId: e.firstHalf.coverUserId,
      date: e.date,
      startTime: e.firstHalf.start,
      endTime: e.firstHalf.end,
      originalShiftId: e.originalShiftId,
      coverForUserId: e.onLeaveUserId,
    })
    rows.push({
      userId: e.secondHalf.coverUserId,
      date: e.date,
      startTime: e.secondHalf.start,
      endTime: e.secondHalf.end,
      originalShiftId: e.originalShiftId,
      coverForUserId: e.onLeaveUserId,
    })
  }
  return rows
}
