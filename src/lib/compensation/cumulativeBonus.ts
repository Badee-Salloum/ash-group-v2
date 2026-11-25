import { db } from '@/lib/db/client'
import { getPayrollEpochStart, getBonusThresholds, BonusThresholds } from '@/lib/settings/global'
import { getActiveBonusRule, applyBonusRule, ruleAppliesToRole, RuleConfig } from '@/lib/compensation/bonusRules'

// Single source of truth for the clean-week cumulative bonus.
//
// Behaviour:
//   - Walks back week-by-week from an anchor week.
//   - Counts each week with ZERO transactions reviewed as EMPLOYEE_ERROR or
//     THEFT (handled by this employee). Streak breaks on the first dirty week.
//   - Stops at the employee's start boundary (hireDate, falling back to user
//     createdAt) so brand-new employees don't get phantom history.
//   - Caps at MAX_LOOKBACK_WEEKS to bound DB work.
//
// Two modes, controlled by `includeAnchorWeek`:
//   - true  (default for dashboards) — start counting at the anchor week
//     itself. Reflects "streak as of right now".
//   - false (used by payroll) — start at the week BEFORE the anchor.
//     Reflects "streak as of last completed week". The current week is
//     still in progress and might still develop an error.
//
// Replaces four duplicated copies that drifted in subtle ways
// (`/api/payroll`, `/api/bonuses` accrue, `/api/bonuses/dashboard`,
// `/api/my/dashboard`). Change the cumulative amount or reset categories
// here once.

// Legacy constant — preserved for back-compat with tests that compute
// expected amounts as streak × CUMULATIVE_PER_WEEK. The runtime amount
// in production now comes from the active BonusRule (no rule = 0);
// this constant has no effect on shipping code paths.
export const CUMULATIVE_PER_WEEK = 5000
export const MAX_LOOKBACK_WEEKS = 24
export const RESET_CATEGORIES = ['EMPLOYEE_ERROR', 'THEFT'] as const

export interface CumulativeStreakResult {
  cleanStreak: number
  amount: number
  lastErrorWeek: Date | null
}

export interface ComputeCumulativeBonusOptions {
  /** Default true. Set false to start counting from the week BEFORE the
   *  anchor (the payroll "as of last completed week" semantic). */
  includeAnchorWeek?: boolean
  /** Override the default MAX_LOOKBACK_WEEKS. */
  maxLookback?: number
}

export interface EmployeeForCumulative {
  id: string
  hireDate: Date | null
  createdAt: Date
  // Optional context — only consulted when applying a BonusRule that
  // restricts target roles or computes a PERCENT/TIERED-by-percent
  // amount from the base salary. Backward-compatible: undefined role
  // means "treat as eligible if rule has no role restriction".
  role?: string | null
  baseSalary?: number | null
}

// Convert clean-week count → SYP amount. Pulls from the active
// BonusRule via applyBonusRule; with no rule, returns 0. With a rule
// whose targetRoles excludes this user, returns 0.
function amountFor(
  cleanStreak: number,
  rule: { config: RuleConfig } | null,
  emp: EmployeeForCumulative,
): number {
  if (cleanStreak <= 0 || !rule) return 0
  if (!ruleAppliesToRole(rule.config, emp.role)) return 0
  return applyBonusRule(cleanStreak, rule.config, emp.baseSalary ?? null)
}

// Resolve the global epoch floor. Any week before this date is invisible to
// the streak walker — it caps cumulative bonus calculation against a
// configurable historical wipe boundary (see /api/admin/payroll-reset).
async function loadEpochFloor(): Promise<Date> {
  const iso = await getPayrollEpochStart()
  const d = new Date(`${iso}T00:00:00Z`)
  d.setHours(0, 0, 0, 0)
  return d
}

// Boundary for one employee = max(hireDate || createdAt, epochFloor).
// Per-employee hire wins if it's AFTER the epoch (new hire post-wipe),
// otherwise epoch wins (the wipe boundary supersedes ancient history).
function computeBoundary(emp: EmployeeForCumulative, epochFloor: Date): Date {
  const hireOrCreated = new Date(emp.hireDate ?? emp.createdAt)
  hireOrCreated.setHours(0, 0, 0, 0)
  return hireOrCreated > epochFloor ? hireOrCreated : epochFloor
}

// Compute streak + amount for ONE employee. Issues one DB count per week
// (bounded by maxLookback). Use the batch variant when iterating over many
// employees.
export async function computeCumulativeBonus(
  employee: EmployeeForCumulative,
  anchorWeekStart: Date,
  options: ComputeCumulativeBonusOptions = {},
): Promise<CumulativeStreakResult> {
  const { includeAnchorWeek = true, maxLookback = MAX_LOOKBACK_WEEKS } = options
  const [epochFloor, rule, thresholds] = await Promise.all([
    loadEpochFloor(),
    getActiveBonusRule(),
    getBonusThresholds(),
  ])
  const boundary = computeBoundary(employee, epochFloor)

  const startW = includeAnchorWeek ? 0 : 1
  let cleanStreak = 0
  let lastErrorWeek: Date | null = null

  for (let w = startW; w < startW + maxLookback; w++) {
    const wsBack = new Date(anchorWeekStart)
    wsBack.setDate(anchorWeekStart.getDate() - 7 * w)
    if (wsBack < boundary) break
    const weBack = new Date(wsBack)
    weBack.setDate(wsBack.getDate() + 7)

    const [handledCount, errorRows, delayCount] = await Promise.all([
      db.transaction.count({
        where: { handledByUserId: employee.id, txDateTime: { gte: wsBack, lt: weBack } },
      }),
      db.transaction.groupBy({
        by: ['currency'],
        where: {
          handledByUserId: employee.id,
          txDateTime: { gte: wsBack, lt: weBack },
          reviewCategory: { in: RESET_CATEGORIES as unknown as string[] },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      db.transaction.count({
        where: {
          handledByUserId: employee.id,
          txDateTime: { gte: wsBack, lt: weBack },
          hasDelay: true,
        },
      }),
    ])

    const errAmounts: Record<string, number> = {}
    let errCount = 0
    for (const r of errorRows as Array<{ currency: string; _count: { _all: number }; _sum: { amount: unknown } }>) {
      errCount += r._count._all
      errAmounts[r.currency] = (errAmounts[r.currency] ?? 0) + Number(r._sum.amount ?? 0)
    }
    if (weekBreachesThresholds({ handledCount, errCount, errAmounts, delayCount }, thresholds)) {
      lastErrorWeek = wsBack
      break
    }
    cleanStreak++
  }
  return {
    cleanStreak,
    amount: amountFor(cleanStreak, rule, employee),
    lastErrorWeek,
  }
}

// Shared week-evaluation predicate — a week is "dirty" whenever ANY of the
// three configurable limits is exceeded: error ratio, per-currency error
// amount, or delay count.
function weekBreachesThresholds(
  week: { handledCount: number; errCount: number; errAmounts: Record<string, number>; delayCount: number },
  thresholds: BonusThresholds,
): boolean {
  const ratio = week.handledCount > 0 ? week.errCount / week.handledCount : (week.errCount > 0 ? 1 : 0)
  if (ratio > thresholds.ratioLimit) return true
  for (const [cur, amt] of Object.entries(week.errAmounts)) {
    const limit = thresholds.amountLimits[cur] ?? Infinity
    if (amt > limit) return true
  }
  if (week.delayCount > thresholds.delayLimit) return true
  return false
}

// Batch variant — single SQL roundtrip for a whole list of employees, instead
// of one round per employee per lookback week. Used by /api/compensation/
// employees (the scorecard) where the previous N-queries-per-N-employees
// O(N×24) pattern made the page slow.
//
// Strategy:
//   1) One groupBy over (handledByUserId, txDateTime bucket) bringing back
//      every error row for every employee in one shot.
//   2) Walk the dataset in JS to bucket into weeks per employee.
//   3) For each employee, walk back week-by-week from the anchor using the
//      bucket map (no further DB calls).
export async function computeCumulativeBonusBatch(
  employees: EmployeeForCumulative[],
  anchorWeekStart: Date,
  options: ComputeCumulativeBonusOptions = {},
): Promise<Map<string, CumulativeStreakResult>> {
  const out = new Map<string, CumulativeStreakResult>()
  if (employees.length === 0) return out

  const { includeAnchorWeek = true, maxLookback = MAX_LOOKBACK_WEEKS } = options
  const startW = includeAnchorWeek ? 0 : 1
  const [epochFloor, rule, thresholds] = await Promise.all([
    loadEpochFloor(),
    getActiveBonusRule(),
    getBonusThresholds(),
  ])

  const earliest = new Date(anchorWeekStart)
  earliest.setDate(anchorWeekStart.getDate() - 7 * (startW + maxLookback))
  const latest = new Date(anchorWeekStart.getTime() + 7 * 86_400_000)

  const empIds = employees.map(e => e.id)
  // Pull every relevant field for every candidate transaction once, then
  // bucket in JS. Narrow to the columns the predicate reads.
  const rows = await db.transaction.findMany({
    where: {
      handledByUserId: { in: empIds },
      txDateTime: { gte: earliest, lt: latest },
    },
    select: {
      handledByUserId: true,
      txDateTime: true,
      reviewCategory: true,
      currency: true,
      amount: true,
      hasDelay: true,
    },
  })

  type Bucket = { handledCount: number; errCount: number; errAmounts: Record<string, number>; delayCount: number }
  const byUserWeek = new Map<string, Map<number, Bucket>>()
  for (const r of rows as Array<{
    handledByUserId: string | null
    txDateTime: Date
    reviewCategory: string | null
    currency: string
    amount: unknown
    hasDelay: boolean
  }>) {
    if (!r.handledByUserId) continue
    const wsKey = weekStartOf(r.txDateTime, anchorWeekStart)
    const perUser = byUserWeek.get(r.handledByUserId) ?? new Map<number, Bucket>()
    const bucket = perUser.get(wsKey) ?? { handledCount: 0, errCount: 0, errAmounts: {}, delayCount: 0 }
    bucket.handledCount += 1
    if (r.reviewCategory === 'EMPLOYEE_ERROR' || r.reviewCategory === 'THEFT') {
      bucket.errCount += 1
      const amt = Number(r.amount ?? 0)
      bucket.errAmounts[r.currency] = (bucket.errAmounts[r.currency] ?? 0) + amt
    }
    if (r.hasDelay) bucket.delayCount += 1
    perUser.set(wsKey, bucket)
    byUserWeek.set(r.handledByUserId, perUser)
  }

  for (const emp of employees) {
    const boundary = computeBoundary(emp, epochFloor)
    const perWeek = byUserWeek.get(emp.id) ?? new Map<number, Bucket>()

    let cleanStreak = 0
    let lastErrorWeek: Date | null = null
    for (let w = startW; w < startW + maxLookback; w++) {
      const wsBack = new Date(anchorWeekStart)
      wsBack.setDate(anchorWeekStart.getDate() - 7 * w)
      if (wsBack < boundary) break
      const bucket = perWeek.get(wsBack.getTime()) ?? { handledCount: 0, errCount: 0, errAmounts: {}, delayCount: 0 }
      if (weekBreachesThresholds(bucket, thresholds)) {
        lastErrorWeek = wsBack
        break
      }
      cleanStreak++
    }
    out.set(emp.id, {
      cleanStreak,
      amount: amountFor(cleanStreak, rule, emp),
      lastErrorWeek,
    })
  }
  return out
}

// Given a transaction's date, return the millisecond start-of-week aligned
// to the same day-of-week as `anchorWeekStart` (so weeks bucket consistently
// with the per-employee streak walk).
function weekStartOf(d: Date, anchor: Date): number {
  const diffDays = Math.floor((d.getTime() - anchor.getTime()) / 86_400_000)
  // Round to nearest multiple of 7 (toward the start of the week containing d)
  const weeks = Math.floor(diffDays / 7)
  const ws = new Date(anchor)
  ws.setDate(anchor.getDate() + weeks * 7)
  ws.setHours(0, 0, 0, 0)
  return ws.getTime()
}

// ─── Phase G perf — weekly trend with one query ────────────────────────────
//
// Replaces the legacy 13-bucket × 2-count loop (26 DB roundtrips) with a
// single DATE_TRUNC groupBy. Postgres `date_trunc('week', …)` is ISO/Monday
// based; we shift by ±1 day to keep the Sunday-start semantic the rest of
// the app uses.

function startOfWeekJs(d: Date): Date {
  const day = d.getDay()
  const m = new Date(d); m.setDate(d.getDate() - day); m.setHours(0, 0, 0, 0)
  return m
}

export interface TrendBucket {
  weekStart: string  // ISO datetime
  matched: number
  errors: number
}

export async function computeWeeklyTrend(
  from: Date,
  to: Date,
  scopedUserIds: string[] | null,
  resetCategories: string[],
): Promise<TrendBucket[]> {
  const firstWeekStart = startOfWeekJs(from)

  // 13-bucket cap defensive — matches the old endpoint behavior on long
  // ranges. Compute the bucket starts up-front so we can return zero-filled
  // entries for weeks with no rows.
  const bucketStarts: Date[] = []
  for (let w = new Date(firstWeekStart); w < to; w.setDate(w.getDate() + 7)) {
    bucketStarts.push(new Date(w))
  }
  const capped = bucketStarts.slice(-13)

  // Single raw SQL groupBy. Sunday-start via the (+1 day) / (-1 day) shift
  // around Postgres's ISO-Monday date_trunc.
  type Row = { week: Date; status: string; cat: string | null; cnt: bigint }
  const rangeStart = capped[0] ?? firstWeekStart
  let rows: Row[]
  if (scopedUserIds && scopedUserIds.length === 0) {
    rows = []
  } else if (scopedUserIds) {
    rows = await db.$queryRaw<Row[]>`
      SELECT (date_trunc('week', "txDateTime" + interval '1 day')::date - interval '1 day')::timestamp AS week,
             "status"::text AS status,
             "reviewCategory"::text AS cat,
             count(*)::bigint AS cnt
      FROM transactions
      WHERE "txDateTime" >= ${rangeStart} AND "txDateTime" < ${to}
        AND "handledByUserId" = ANY(${scopedUserIds}::text[])
      GROUP BY 1, 2, 3
    `
  } else {
    rows = await db.$queryRaw<Row[]>`
      SELECT (date_trunc('week', "txDateTime" + interval '1 day')::date - interval '1 day')::timestamp AS week,
             "status"::text AS status,
             "reviewCategory"::text AS cat,
             count(*)::bigint AS cnt
      FROM transactions
      WHERE "txDateTime" >= ${rangeStart} AND "txDateTime" < ${to}
        AND "handledByUserId" IS NOT NULL
      GROUP BY 1, 2, 3
    `
  }

  // Bucket the grouped rows by their week-start ms.
  const matchedByWeek = new Map<number, number>()
  const errorsByWeek = new Map<number, number>()
  const resetSet = new Set(resetCategories)
  for (const r of rows) {
    const ws = new Date(r.week); ws.setHours(0, 0, 0, 0)
    const key = ws.getTime()
    const cnt = Number(r.cnt)
    if (r.status === 'MATCHED') {
      matchedByWeek.set(key, (matchedByWeek.get(key) || 0) + cnt)
    }
    if (r.cat && resetSet.has(r.cat)) {
      errorsByWeek.set(key, (errorsByWeek.get(key) || 0) + cnt)
    }
  }

  return capped.map(b => {
    const key = b.getTime()
    return {
      weekStart: b.toISOString(),
      matched: matchedByWeek.get(key) || 0,
      errors: errorsByWeek.get(key) || 0,
    }
  })
}
