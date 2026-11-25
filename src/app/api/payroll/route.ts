import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { getPayrollEpochStart } from '@/lib/settings/global'
import { computeCumulativeBonusBatch } from '@/lib/compensation/cumulativeBonus'
import { damascusDateStr } from '@/lib/datetime'
import { createPayrollPaidNotification, createDeductionNotification } from '@/lib/notifications/helpers'
import { z } from 'zod'

// Module G — Weekly payroll.
// GET ?weekStart=YYYY-MM-DD → list payroll entries for that week
// POST { weekStart, weekEnd } → generate (or refresh) payroll for all active employees
// PATCH { id, ... } → manual adjustment (deductions, bonus override, mark paid)

// First day of the working week, configurable per deployment.
// 0 = Sunday (default — Syrian work week), 1 = Monday, 6 = Saturday, etc.
const FIRST_DAY_OF_WEEK = parseInt(process.env.WEEK_START_DAY || '0', 10)

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const diff = (day - FIRST_DAY_OF_WEEK + 7) % 7
  const m = new Date(d)
  m.setDate(d.getDate() - diff)
  m.setHours(0, 0, 0, 0)
  return m
}
function endOfWeek(d: Date): Date {
  const e = new Date(startOfWeek(d))
  e.setDate(e.getDate() + 6)
  e.setHours(23, 59, 59, 999)
  return e
}

/**
 * Payroll only needs the number of distinct local calendar days per employee.
 * Build it from the one period-wide session read, rather than issuing one
 * ShiftSession query per employee.
 */
function daysWorkedByUser(sessions: Array<{ userId: string; startAt: Date }>): Map<string, number> {
  const daySets = new Map<string, Set<string>>()
  for (const session of sessions) {
    const days = daySets.get(session.userId) ?? new Set<string>()
    days.add(damascusDateStr(session.startAt))
    daySets.set(session.userId, days)
  }

  return new Map(Array.from(daySets, ([userId, days]) => [userId, days.size]))
}

/** Keep GROUP/MANUAL bonus aggregation in one query and one small map. */
function bonusTotalsByUser(rows: Array<{ userId: string; _sum: { amount: unknown } }>): Map<string, number> {
  return new Map(rows.map(row => [row.userId, Number(row._sum.amount || 0)]))
}

function cumulativeEmployees(employees: Array<{
  id: string
  hireDate: Date | null
  createdAt: Date
  role: string | null
  baseSalary: unknown
}>) {
  return employees.map(employee => ({
    id: employee.id,
    hireDate: employee.hireDate ?? null,
    createdAt: employee.createdAt ?? new Date(),
    role: employee.role,
    baseSalary: employee.baseSalary != null ? Number(employee.baseSalary) : null,
  }))
}

// LIVE payroll computation. Run on every page load — there is no manual
// "generate" step for the current week. Salary is per-DAY-worked:
//
//   workingDaysInWeek    = 6 if user.weeklyOffDay ∈ [0..6], else 7
//   dailyRate            = baseSalary / workingDaysInWeek
//   daysWorked           = number of distinct calendar days within the period
//                          on which the employee had at least one shift session
//                          (clamped to days since hireDate)
//   proRated             = dailyRate × daysWorked
//   net                  = proRated + bonuses − deductions
//
// Two modes:
//   1) ?weekStart=YYYY-MM-DD → single week (default if no params)
//   2) ?from=YYYY-MM-DD&to=YYYY-MM-DD → arbitrary range (aggregated, live only —
//      no PAID snapshots respected; status always DRAFT for range mode)
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const fromParam = params.get('from')
  const toParam = params.get('to')
  const isRangeMode = !!(fromParam && toParam)

  let ws: Date, we: Date
  if (isRangeMode) {
    ws = new Date(fromParam!); ws.setHours(0, 0, 0, 0)
    we = new Date(toParam!); we.setHours(23, 59, 59, 999)
  } else {
    const weekStart = params.get('weekStart') ? new Date(params.get('weekStart')!) : startOfWeek(new Date())
    ws = startOfWeek(weekStart)
    we = endOfWeek(weekStart)
  }

  // 1. All active employees. Those without a baseSalary still appear so their
  // bonuses (cumulative + group + manual) are visible — only the salary
  // portion is zero. `weeklyOffDay` is a fixed day-of-week (0..6) or null;
  // null means the employee works a 7-day week.
  const employees = await db.user.findMany({
    where: { isActive: true },
    select: {
      id: true, name: true, jobTitle: true, employeeCode: true, avatarUrl: true,
      baseSalary: true, hireDate: true, createdAt: true, weeklyOffDay: true, role: true,
    },
    orderBy: { name: 'asc' },
  })
  const employeeIds = employees.map((employee: { id: string }) => employee.id)

  // 2. Fetch any PRE-EXISTING entries for this period (paid snapshots, edits)
  // — only relevant in single-week mode. Range mode is always live/draft.
  // All period reads are batched. This stays constant as headcount grows:
  // entries + sessions + grouped bonuses + shared cumulative-bonus batch.
  const [epochIso, existingEntries, sessions, otherBonusRows, cumulativeByUser] = await Promise.all([
    getPayrollEpochStart(),
    isRangeMode ? Promise.resolve([]) : db.payrollEntry.findMany({ where: { weekStart: ws } }),
    employeeIds.length === 0
      ? Promise.resolve([])
      : db.shiftSession.findMany({
        where: {
          userId: { in: employeeIds },
          status: { in: ['COMPLETED', 'ACTIVE', 'PENDING_END'] },
          startAt: { gte: ws, lte: we },
        },
        select: { userId: true, startAt: true },
      }),
    employeeIds.length === 0
      ? Promise.resolve([])
      : db.bonusLog.groupBy({
        by: ['userId'],
        where: {
          userId: { in: employeeIds },
          type: { in: ['GROUP', 'MANUAL'] },
          ...(isRangeMode ? { weekStart: { gte: ws, lte: we } } : { weekStart: ws }),
        },
        _sum: { amount: true },
      }),
    computeCumulativeBonusBatch(cumulativeEmployees(employees), ws, { includeAnchorWeek: false }),
  ])
  type ExistingEntry = typeof existingEntries[0]
  const byUser = new Map<string, ExistingEntry>()
  for (const e of existingEntries) byUser.set(e.userId, e)

  // Hard floor — sessions before the payroll epoch are invisible to salary
  // calculations so a fresh-start wipe (see /api/admin/payroll-reset) is
  // never undermined by lingering pre-epoch ShiftSessions.
  const epochFloor = new Date(`${epochIso}T00:00:00.000Z`)
  const effectiveWs = ws > epochFloor ? ws : epochFloor
  const daysByUser = daysWorkedByUser(
    (sessions as Array<{ userId: string; startAt: Date }>).filter(sessionRow => sessionRow.startAt >= effectiveWs),
  )
  const otherBonusesByUser = bonusTotalsByUser(
    otherBonusRows as Array<{ userId: string; _sum: { amount: unknown } }>,
  )

  const out: Array<Record<string, unknown>> = []
  for (const emp of employees) {
    const baseSalary = Number(emp.baseSalary || 0)
    const workingDaysPerWeek = emp.weeklyOffDay != null ? 6 : 7
    const dailyRate = baseSalary / workingDaysPerWeek

    // Count distinct DAYS the employee had a completed session inside this
    // week — sessions before the global epoch are dropped so wiped history
    // can't inflate the current period's days-worked.
    // The one batched query above is keyed by Damascus calendar day so local
    // midnight sessions retain the same behavior as the previous per-user
    // loop without its N+1 reads.
    let daysWorked = daysByUser.get(emp.id) ?? 0

    // Cap days-worked by hireDate window (e.g. employee started mid-week)
    if (emp.hireDate) {
      const hire = new Date(emp.hireDate); hire.setHours(0, 0, 0, 0)
      if (hire > ws) {
        // available working days between hireDate and end of week
        const msPerDay = 86_400_000
        const availDays = Math.max(0, Math.floor((we.getTime() - hire.getTime()) / msPerDay) + 1)
        daysWorked = Math.min(daysWorked, availDays)
      }
    }

    // 3a. GROUP/MANUAL bonuses for this period (these are explicitly added)
    const groupedBonusAmount = otherBonusesByUser.get(emp.id) ?? 0

    // 3b. CUMULATIVE bonus — computed LIVE via the shared helper.
    // Payroll uses "as of last completed week" semantics
    // (includeAnchorWeek: false) so the current in-progress week never
    // shortens the streak before it's actually finished.
    const cumulativeAmount = cumulativeByUser.get(emp.id)?.amount ?? 0
    const bonusFromLogs = groupedBonusAmount + cumulativeAmount

    // 4. Merge with persisted entry (if any). PAID entries are frozen.
    const persisted = byUser.get(emp.id)
    const isPaid = persisted?.status === 'PAID'

    // Fixed-salary semantics: full baseSalary per WEEK is owed when the
    // employee works at least `workingDaysPerWeek` days that week. In
    // range mode the cap scales to the EFFECTIVE width (queried range
    // intersected with the epoch floor) so pre-epoch days neither count
    // toward worked NOR expected. No overtime above the period total.
    const totalDaysInPeriod = Math.max(1, Math.ceil((we.getTime() - effectiveWs.getTime()) / 86_400_000) + 1)
    const weeksInPeriod = totalDaysInPeriod / 7
    const workingDaysOverPeriod = isRangeMode
      ? Math.max(1, Math.round(weeksInPeriod * workingDaysPerWeek))
      : workingDaysPerWeek
    const effectiveDays = Math.min(daysWorked, workingDaysOverPeriod)
    const proRated = dailyRate * effectiveDays
    const liveBonus = isPaid ? Number(persisted!.bonusAmount) : (persisted ? Number(persisted.bonusAmount) || bonusFromLogs : bonusFromLogs)
    const liveDeductions = persisted ? Number(persisted.deductions) : 0
    const liveProRated = isPaid
      ? Number(persisted!.baseSalary) * Math.min(Number(persisted!.workedHours), Math.max(1, Number(persisted!.expectedHours))) / Math.max(1, Number(persisted!.expectedHours))
      : proRated
    const netAmount = isPaid ? Number(persisted!.netAmount) : (liveProRated + liveBonus - liveDeductions)

    out.push({
      id: persisted?.id || `live-${emp.id}-${ws.toISOString().slice(0,10)}`,
      userId: emp.id,
      user: { ...emp, baseSalary: emp.baseSalary != null ? Number(emp.baseSalary) : null },
      weekStart: ws.toISOString(),
      weekEnd: we.toISOString(),
      baseSalary,
      // Re-purposed for daily display: store days-worked in workedHours, and
      // working-days-over-period in expectedHours.
      workedHours: daysWorked,
      expectedHours: workingDaysOverPeriod,
      dailyRate,
      bonusAmount: liveBonus,
      advanceAmount: 0,
      deductions: liveDeductions,
      netAmount,
      status: persisted?.status || 'DRAFT',
      paidAt: persisted?.paidAt ?? null,
      notes: persisted?.notes ?? null,
      isLive: !persisted,
    })
  }

  return NextResponse.json({
    success: true,
    weekStart: ws.toISOString(),
    weekEnd: we.toISOString(),
    computedAt: new Date().toISOString(),
    data: out,
  })
}

const generateSchema = z.object({
  weekStart: z.string(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const body = await req.json()
    const { weekStart } = generateSchema.parse(body)
    const ws = startOfWeek(new Date(weekStart))
    const we = endOfWeek(ws)

    const employees = await db.user.findMany({
      where: { isActive: true, baseSalary: { not: null } },
      select: { id: true, baseSalary: true, hireDate: true, createdAt: true, weeklyOffDay: true, role: true },
    })
    const employeeIds = employees.map((employee: { id: string }) => employee.id)
    const epochIso = await getPayrollEpochStart()
    const epochFloor = new Date(`${epochIso}T00:00:00.000Z`)
    const effectiveWs = ws > epochFloor ? ws : epochFloor

    // Generation used to read sessions, bonuses, advances and the existing
    // payroll row separately for every employee. Fetch each relation once,
    // then map it by user. Only the required creates/updates below scale with
    // headcount; database reads remain bounded.
    const [sessions, otherBonusRows, advances, existingEntries, cumulativeByUser] = await Promise.all([
      employeeIds.length === 0
        ? Promise.resolve([])
        : db.shiftSession.findMany({
          where: {
            userId: { in: employeeIds },
            status: { in: ['COMPLETED', 'ACTIVE', 'PENDING_END'] },
            startAt: { gte: effectiveWs, lte: we },
          },
          select: { userId: true, startAt: true },
        }),
      employeeIds.length === 0
        ? Promise.resolve([])
        : db.bonusLog.groupBy({
          by: ['userId'],
          where: {
            userId: { in: employeeIds },
            weekStart: ws,
            type: { in: ['GROUP', 'MANUAL'] },
          },
          _sum: { amount: true },
        }),
      employeeIds.length === 0
        ? Promise.resolve([])
        : db.advanceRequest.findMany({
          where: { userId: { in: employeeIds }, status: 'APPROVED', payrollEntryId: null },
          select: { id: true, userId: true, amount: true },
        }),
      employeeIds.length === 0
        ? Promise.resolve([])
        : db.payrollEntry.findMany({
          where: { userId: { in: employeeIds }, weekStart: ws },
          select: { id: true, userId: true },
        }),
      computeCumulativeBonusBatch(cumulativeEmployees(employees), ws, { includeAnchorWeek: false }),
    ])
    const daysByUser = daysWorkedByUser(sessions as Array<{ userId: string; startAt: Date }>)
    const otherBonusesByUser = bonusTotalsByUser(
      otherBonusRows as Array<{ userId: string; _sum: { amount: unknown } }>,
    )
    const advancesByUser = new Map<string, Array<{ id: string; userId: string; amount: unknown }>>()
    for (const advance of advances as Array<{ id: string; userId: string; amount: unknown }>) {
      const userAdvances = advancesByUser.get(advance.userId) ?? []
      userAdvances.push(advance)
      advancesByUser.set(advance.userId, userAdvances)
    }
    const existingByUser = new Map<string, { id: string; userId: string }>(
      (existingEntries as Array<{ id: string; userId: string }>).map(entry => [entry.userId, entry]),
    )

    let created = 0, refreshed = 0
    for (const emp of employees) {
      // Count distinct days the employee had any session in this week
      // (mirrors the GET handler's day-based semantics so the same
      // PayrollEntry record renders identically across both paths).
      // Sessions before the epoch are dropped — same floor as GET.
      const daysWorked = daysByUser.get(emp.id) ?? 0

      const workingDays = emp.weeklyOffDay != null ? 6 : 7

      // Cumulative bonus — compute LIVE via the shared helper so the
      // generated PayrollEntry carries the full earned-but-unpaid
      // streak amount.
      const cumulativeAmount = cumulativeByUser.get(emp.id)?.amount ?? 0
      const bonusAmount = cumulativeAmount + (otherBonusesByUser.get(emp.id) ?? 0)

      // Pending advances → APPROVED ones become PAID upon payroll generation
      const employeeAdvances = advancesByUser.get(emp.id) ?? []
      const advanceAmount = employeeAdvances.reduce((sum, advance) => sum + Number(advance.amount), 0)

      const baseSalary = Number(emp.baseSalary || 0)
      // Fixed-salary formula: full pay when daysWorked ≥ workingDays;
      // each absent day docks dailyRate; no overtime above baseSalary.
      const effectiveDays = Math.min(daysWorked, workingDays)
      const proRated = baseSalary * effectiveDays / workingDays
      // Reuse the schema fields the same way GET does — workedHours
      // stores daysWorked, expectedHours stores workingDays.
      const workedHours = daysWorked
      const expectedHours = workingDays
      const netAmount = proRated + bonusAmount - advanceAmount

      const existing = existingByUser.get(emp.id)
      if (existing) {
        await db.payrollEntry.update({
          where: { id: existing.id },
          data: { workedHours, bonusAmount, advanceAmount, netAmount },
        })
        refreshed++
      } else {
        const entry = await db.payrollEntry.create({
          data: {
            userId: emp.id,
            weekStart: ws,
            weekEnd: we,
            baseSalary,
            workedHours,
            expectedHours,
            bonusAmount,
            advanceAmount,
            deductions: 0,
            netAmount,
            status: 'DRAFT',
          },
        })
        // Link advances to this entry & mark paid
        if (employeeAdvances.length > 0) {
          await db.advanceRequest.updateMany({
            where: { id: { in: employeeAdvances.map(advance => advance.id) } },
            data: { payrollEntryId: entry.id, status: 'PAID' },
          })
        }
        created++
      }
    }

    await audit(session.userId, 'GENERATE_PAYROLL', 'PayrollEntry', null as unknown as string, {
      weekStart: ws, created, refreshed,
    })
    return NextResponse.json({ success: true, created, refreshed })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

const patchSchema = z.object({
  id: z.string(),
  bonusAmount: z.number().optional(),
  deductions: z.number().optional(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'PAID']).optional(),
  notes: z.string().optional(),
})

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const body = await req.json()
    const { id, ...rest } = patchSchema.parse(body)

    // Live ids look like `live-<userId>-<YYYY-MM-DD>` and represent a
    // computed-on-the-fly payroll for an employee who doesn't have a saved
    // entry yet. Materialize one before mutating.
    let existing = await db.payrollEntry.findUnique({ where: { id } })
    if (!existing && id.startsWith('live-')) {
      const m = id.match(/^live-(.+)-(\d{4}-\d{2}-\d{2})$/)
      if (m) {
        const liveUserId = m[1]
        const liveWs = new Date(m[2] + 'T00:00:00Z')
        const liveWe = endOfWeek(liveWs)
        const emp = await db.user.findUnique({
          where: { id: liveUserId },
          select: { baseSalary: true, weeklyOffDay: true },
        })
        const baseSalary = emp?.baseSalary != null ? Number(emp.baseSalary) : 0
        const workingDays = emp?.weeklyOffDay != null ? 6 : 7
        const sessions = await db.shiftSession.findMany({
          where: { userId: liveUserId, status: { in: ['COMPLETED', 'ACTIVE', 'PENDING_END'] }, startAt: { gte: liveWs, lte: liveWe } },
          select: { startAt: true },
        })
        const daySet = new Set<string>()
        for (const s of sessions) daySet.add(damascusDateStr(s.startAt))
        const daysWorked = daySet.size

        existing = await db.payrollEntry.create({
          data: {
            userId: liveUserId,
            weekStart: liveWs,
            weekEnd: liveWe,
            baseSalary,
            workedHours: daysWorked,
            expectedHours: workingDays,
            bonusAmount: 0,
            advanceAmount: 0,
            deductions: 0,
            netAmount: (baseSalary / workingDays) * daysWorked,
            status: 'DRAFT',
          },
        })
      }
    }
    if (!existing) return NextResponse.json({ error: 'السجل غير موجود' }, { status: 404 })

    // Recompute net if bonus/deductions changed (null-safe coercions).
    // Same fixed-salary formula as GET/POST: cap at workingDays so editing
    // a partly-worked week doesn't accidentally inflate via overtime.
    const baseSalary = existing.baseSalary != null ? Number(existing.baseSalary) : 0
    const workedHours = existing.workedHours != null ? Number(existing.workedHours) : 0
    const expectedHours = existing.expectedHours != null ? Number(existing.expectedHours) : 0
    const advanceAmount = existing.advanceAmount != null ? Number(existing.advanceAmount) : 0
    const bonusAmount = rest.bonusAmount ?? (existing.bonusAmount != null ? Number(existing.bonusAmount) : 0)
    const deductions = rest.deductions ?? (existing.deductions != null ? Number(existing.deductions) : 0)
    const workingDays = Math.max(1, expectedHours)
    const effectiveDays = Math.min(workedHours, workingDays)
    const proRated = baseSalary * effectiveDays / workingDays
    const netAmount = proRated + bonusAmount - advanceAmount - deductions

    const updateData: Record<string, unknown> = { bonusAmount, deductions, netAmount }
    if (rest.status) {
      updateData.status = rest.status
      if (rest.status === 'PAID') updateData.paidAt = new Date()
    }
    if (rest.notes !== undefined) updateData.notes = rest.notes

    // Use existing.id (may have changed if we just materialized a live entry)
    await db.payrollEntry.update({ where: { id: existing.id }, data: updateData })

    // Phase E — fire-and-forget notifications. We notify on (a) status flip
    // to PAID, and (b) deduction increases applied while editing a draft.
    if (rest.status === 'PAID' && existing.status !== 'PAID') {
      await createPayrollPaidNotification({
        userId: existing.userId,
        netAmount,
        weekStart: existing.weekStart,
        // Split for the title — "تم دفع راتبك (0 ل.س)" was misleading
        // when the payout was entirely bonus.
        salaryAmount: Math.max(0, proRated - deductions),
        bonusAmount,
      })
    }
    if (rest.deductions !== undefined && rest.status !== 'PAID') {
      const prevDed = existing.deductions != null ? Number(existing.deductions) : 0
      const delta = deductions - prevDed
      if (delta > 0) {
        await createDeductionNotification({
          userId: existing.userId,
          amount: delta,
          reason: rest.notes ?? null,
          weekStart: existing.weekStart,
        })
      }
    }

    // Auto-link to expenses: when status flips to/from PAID, sync TWO
    // separate Expense rows so the accountant can see salaries and
    // bonuses as distinct categories in /expenses:
    //   - salary expense: tag "[payroll:<id>]", amount = base proRated − deductions
    //   - bonus  expense: tag "[payroll:<id> · bonus]", amount = bonusAmount (only when > 0)
    // Back-compat: legacy rows used a single "[payroll:<id>]" tagged
    // expense holding the full netAmount. The salary-expense branch
    // below detects that shape and rewrites the amount/description
    // in-place, then creates the missing bonus sibling if needed.
    const becamePaid = rest.status === 'PAID' && existing.status !== 'PAID'
    const unpaid = existing.status === 'PAID' && rest.status && rest.status !== 'PAID'
    const alreadyPaidAmountChange = existing.status === 'PAID' && (rest.bonusAmount !== undefined || rest.deductions !== undefined)
    // A PATCH that re-asserts PAID on an already-PAID entry is treated as
    // "resync the linked expenses". The scorecard's pay flow re-runs POST
    // /api/payroll first to refresh the entry's bonusAmount from the live
    // cumulative streak — without this branch the resync would no-op and
    // a stale (or missing) bonus expense would never get reconciled.
    const repaidRefresh = rest.status === 'PAID' && existing.status === 'PAID'

    if (becamePaid || alreadyPaidAmountChange || repaidRefresh) {
      const empUser = await db.user.findUnique({
        where: { id: existing.userId },
        select: { name: true, employeeCode: true },
      })
      const empLabel = `${empUser?.name || 'موظف'}${empUser?.employeeCode ? ` (${empUser.employeeCode})` : ''}`
      const wk = new Date(existing.weekStart).toISOString().slice(0, 10)
      const weekEndStr = new Date(existing.weekEnd).toISOString().slice(0, 10)
      const salaryTag = `[payroll:${existing.id}]`
      const bonusTag = `[payroll:${existing.id} · bonus]`
      const salaryAmount = Math.max(0, proRated - deductions)
      const notesLine = existing.notes ? `\n• ملاحظات: ${existing.notes}` : ''

      const salaryDesc =
        `راتب ${empLabel} — أسبوع ${wk} → ${weekEndStr}\n` +
        `• أساسي ${Math.round(baseSalary).toLocaleString('en')} ل.س × ${workedHours.toFixed(1)}/${expectedHours.toFixed(1)}\n` +
        (deductions > 0 ? `• خصومات ${Math.round(deductions).toLocaleString('en')} ل.س\n` : '') +
        `• صافي الراتب ${Math.round(salaryAmount).toLocaleString('en')} ل.س` +
        notesLine + ` ${salaryTag}`
      const bonusDesc =
        `مكافأة ${empLabel} — أسبوع ${wk} → ${weekEndStr}\n` +
        `• المبلغ ${Math.round(bonusAmount).toLocaleString('en')} ل.س` +
        ` ${bonusTag}`

      // Salary expense: upsert by exact tag match. Updating in place rewrites
      // legacy single-expense rows to the new split shape too.
      const existingSalary = await db.expense.findFirst({
        where: { description: { contains: salaryTag }, deletedAt: null },
      })
      if (existingSalary) {
        await db.expense.update({
          where: { id: existingSalary.id },
          data: { amount: salaryAmount, description: salaryDesc, category: 'رواتب' },
        })
      } else {
        await db.expense.create({
          data: {
            description: salaryDesc,
            amount: salaryAmount,
            category: 'رواتب',
            expenseDate: new Date(),
            userId: session.userId,
          },
        })
      }

      // Bonus expense: only when bonusAmount > 0. Otherwise remove any
      // stale sibling left over from a previous payment.
      const existingBonus = await db.expense.findFirst({
        where: { description: { contains: bonusTag }, deletedAt: null },
      })
      if (bonusAmount > 0) {
        if (existingBonus) {
          await db.expense.update({
            where: { id: existingBonus.id },
            data: { amount: bonusAmount, description: bonusDesc, category: 'مكافآت' },
          })
        } else {
          await db.expense.create({
            data: {
              description: bonusDesc,
              amount: bonusAmount,
              category: 'مكافآت',
              expenseDate: new Date(),
              userId: session.userId,
            },
          })
        }
      } else if (existingBonus) {
        await db.expense.update({
          where: { id: existingBonus.id },
          data: { deletedAt: new Date() },
        })
      }
    } else if (unpaid) {
      // PAID → DRAFT/CONFIRMED: soft-delete both linked expenses (salary +
      // bonus). They'll be re-created on the next mark-as-paid.
      const salaryTag = `[payroll:${existing.id}]`
      const bonusTag = `[payroll:${existing.id} · bonus]`
      await db.expense.updateMany({
        where: {
          deletedAt: null,
          OR: [
            { description: { contains: bonusTag } },
            // Salary tag is a substring of bonus tag (same prefix), so
            // match the closing bracket too — the salary tag ends with
            // "]" while the bonus tag continues with " · bonus]".
            { AND: [{ description: { contains: salaryTag } }, { NOT: { description: { contains: bonusTag } } }] },
          ],
        },
        data: { deletedAt: new Date() },
      })
    }

    await audit(session.userId, 'UPDATE_PAYROLL', 'PayrollEntry', id, rest)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
