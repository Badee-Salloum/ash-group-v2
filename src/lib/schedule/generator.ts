// Weekly shift generator — deterministic, side-effect-free.
//
// Behavior:
//   1. Each employee is pinned to ONE shift number (ONE / TWO / THREE) for the
//      whole week — circadian continuity. Distribution is round-robin by index.
//   2. Each employee gets `weeklyOffDays` days off (1..3). The off-window for
//      employee[i] within shift S starts at offset
//          (i // 3 * weeklyOffDays) % 7
//      so different team members rotate through different off-days. This
//      avoids the "everyone on shift TWO is off Friday" failure mode.
//   3. `minPerShift` is a floor: if marking the natural off-days would push
//      a shift below `minPerShift` working employees on a given day, the
//      marginal employee(s) are forced to work that day instead.
//   4. Output is fully deterministic — sorting input by id guarantees the
//      same input twice produces byte-identical output (helps testing and
//      makes the "اقتراح" button idempotent for users).

export type ShiftNumber = 'ONE' | 'TWO' | 'THREE'

export interface Employee {
  id: string
  weeklyOffDays?: number // 1..3, default 1
}

export interface ShiftPlan {
  date: string // YYYY-MM-DD
  shiftNumber: ShiftNumber
  userId: string
  isDayOff: boolean
}

export interface GenerateResult {
  shifts: ShiftPlan[]
  /** userId → the shift number that employee is on this whole week. */
  assignments: Record<string, ShiftNumber>
}

const SHIFTS: ShiftNumber[] = ['ONE', 'TWO', 'THREE']

function fmtDate(d: Date): string {
  // YYYY-MM-DD in the date's local components (the caller passes weekStart
  // anchored to local Sunday, so this is correct without TZ math).
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function clampOffDays(n: number | undefined): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(3, Math.max(0, Math.floor(n as number)))
}

export function generateWeeklySchedule(opts: {
  weekStart: Date // any time on the desired Sunday
  employees: Employee[]
  minPerShift: number
}): GenerateResult {
  const { weekStart, minPerShift } = opts
  // Sort by id for determinism. We don't mutate the caller's array.
  const employees = [...opts.employees].sort((a, b) => a.id.localeCompare(b.id))

  // Step 1 — pin each employee to a shift number for the week.
  const assignments: Record<string, ShiftNumber> = {}
  const rosters: Record<ShiftNumber, Employee[]> = { ONE: [], TWO: [], THREE: [] }
  for (let i = 0; i < employees.length; i++) {
    const sn = SHIFTS[i % 3]
    assignments[employees[i].id] = sn
    rosters[sn].push(employees[i])
  }

  // Step 2 — pre-compute the natural off-day set for each employee.
  // Off-windows are staggered within a shift roster so adjacent employees
  // don't share an off-day. For employee at roster-index `i` with off=k,
  // the off-window starts at (i * k) % 7. This produces non-overlapping
  // windows whenever the roster size × k ≤ 7; beyond that we accept some
  // overlap (which `minPerShift` then resolves via promotion).
  const offSets = new Map<string, Set<number>>()
  for (const sn of SHIFTS) {
    const roster = rosters[sn]
    for (let i = 0; i < roster.length; i++) {
      const emp = roster[i]
      const off = clampOffDays(emp.weeklyOffDays)
      const start = (i * Math.max(1, off)) % 7
      const set = new Set<number>()
      for (let k = 0; k < off; k++) {
        set.add((start + k) % 7)
      }
      offSets.set(emp.id, set)
    }
  }

  // Step 3 — emit one ShiftPlan per (day, employee). For each shift+day,
  // count working employees and, if below minPerShift, force the marginal
  // employees (lowest roster index whose natural day is "off") to work
  // instead. We never go below the natural off count if it would block
  // the floor — i.e., minPerShift wins over off-days.
  const shifts: ShiftPlan[] = []
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + dayOffset)
    const dateStr = fmtDate(date)

    for (const sn of SHIFTS) {
      const roster = rosters[sn]
      // First pass — mark intended off/working
      const planned = roster.map(e => ({
        userId: e.id,
        isDayOff: offSets.get(e.id)!.has(dayOffset),
      }))
      // Enforce minPerShift floor
      const workingCount = planned.filter(p => !p.isDayOff).length
      if (workingCount < minPerShift) {
        const need = minPerShift - workingCount
        let promoted = 0
        for (const p of planned) {
          if (promoted >= need) break
          if (p.isDayOff) {
            p.isDayOff = false
            promoted++
          }
        }
      }
      for (const p of planned) {
        shifts.push({
          date: dateStr,
          shiftNumber: sn,
          userId: p.userId,
          isDayOff: p.isDayOff,
        })
      }
    }
  }

  return { shifts, assignments }
}
