// Shared aggregation helpers used by /api/compensation/{overview,employees,dashboard}.
// Lives outside the route directory so Next.js's route-file export rules
// don't get angry (route files may only export GET/POST/revalidate/...).

import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import {
  computeCumulativeBonusBatch,
  RESET_CATEGORIES,
} from '@/lib/compensation/cumulativeBonus'
import { getPayrollEpochStart } from '@/lib/settings/global'
import { damascusDateStr } from '@/lib/datetime'

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const m = new Date(d)
  m.setDate(d.getDate() - day)
  m.setHours(0, 0, 0, 0)
  return m
}

// ─── Pending dues (Overview tab card) ──────────────────────────────────────
//
// Three sources of "pending":
//   1. Persisted PayrollEntry rows in the period whose status != PAID —
//      take them at face value (netAmount minus bonus, since bonus is its
//      own line item now).
//   2. Active employees with no PayrollEntry for the CURRENT week at all
//      — count them as pending with an estimated amount equal to their
//      baseSalary. This catches the common case where the week's entries
//      haven't been generated yet but salary is still owed.
//   3. BonusLog rows in the period whose linked weekly PayrollEntry is
//      either missing or not PAID.
export async function computePendingDues(from: Date, to: Date, scopedUserIds: string[] | null) {
  const userFilter = scopedUserIds ? { in: scopedUserIds } : undefined

  // Current week (Sunday-start) — used to detect "no entry yet" cases.
  const currentWeekStart = startOfWeek(new Date())

  const [unpaidEntries, paidUserWeeks, currentWeekEntries, activeEmployees, bonusRows] = await Promise.all([
    db.payrollEntry.findMany({
      where: {
        status: { not: 'PAID' },
        weekStart: { gte: from, lte: to },
        ...(userFilter ? { userId: userFilter } : {}),
      },
      select: { id: true, userId: true, netAmount: true, bonusAmount: true, weekStart: true },
    }),
    db.payrollEntry.findMany({
      where: {
        status: 'PAID',
        weekStart: { gte: from, lte: to },
        ...(userFilter ? { userId: userFilter } : {}),
      },
      select: { userId: true, weekStart: true },
    }),
    db.payrollEntry.findMany({
      where: {
        weekStart: currentWeekStart,
        ...(userFilter ? { userId: userFilter } : {}),
      },
      select: { userId: true, status: true },
    }),
    db.user.findMany({
      where: {
        isActive: true,
        baseSalary: { not: null },
        ...(userFilter ? { id: userFilter } : {}),
      },
      select: { id: true, baseSalary: true, hireDate: true, createdAt: true, weeklyOffDay: true, role: true },
    }),
    db.bonusLog.findMany({
      where: {
        appliedAt: { gte: from, lte: to },
        ...(userFilter ? { userId: userFilter } : {}),
        type: { in: ['GROUP', 'MANUAL', 'CUMULATIVE'] },
      },
      select: { userId: true, weekStart: true, amount: true },
    }),
  ])

  // 1) Tally unpaid persisted entries (netAmount, excluding bonus —
  // bonus is the second category).
  type UnpaidRow = { id: string; userId: string; netAmount: unknown; bonusAmount: unknown; weekStart: Date }
  let pendingPayrollCount = 0
  let pendingPayrollAmount = 0
  for (const e of unpaidEntries as UnpaidRow[]) {
    pendingPayrollCount += 1
    pendingPayrollAmount += Number(e.netAmount || 0) - Number(e.bonusAmount || 0)
  }

  // 2) "No entry yet" employees for the current week. Mirror the fixed-
  // salary formula from /api/payroll exactly: prorate by days actually
  // worked this week, capped at workingDaysPerWeek (no overtime), with
  // sessions before the global epoch dropped. The previous logic counted
  // baseSalary in full for every employee with no entry, which over-stated
  // the pending bucket by 7× on day 1 of a new week.
  type ActiveEmp = { id: string; baseSalary: unknown; hireDate: Date | null; createdAt: Date; weeklyOffDay: number | null; role: string | null }
  type CurEntry = { userId: string; status: string }
  const hasCurrentEntry = new Set((currentWeekEntries as CurEntry[]).map(e => e.userId))
  const missingEmps = (activeEmployees as ActiveEmp[]).filter(e => !hasCurrentEntry.has(e.id))

  if (missingEmps.length > 0) {
    const epochIso = await getPayrollEpochStart()
    const epochFloor = new Date(`${epochIso}T00:00:00.000Z`)
    const weCurrent = new Date(currentWeekStart)
    weCurrent.setDate(weCurrent.getDate() + 6)
    weCurrent.setHours(23, 59, 59, 999)
    const effectiveStart = currentWeekStart > epochFloor ? currentWeekStart : epochFloor

    // Batched: one shiftSession query for all missing employees this week.
    const sessions = await db.shiftSession.findMany({
      where: {
        userId: { in: missingEmps.map(e => e.id) },
        status: { in: ['COMPLETED', 'ACTIVE', 'PENDING_END'] },
        startAt: { gte: effectiveStart, lte: weCurrent },
      },
      select: { userId: true, startAt: true },
    })
    const daysByUser = new Map<string, Set<string>>()
    for (const s of sessions as Array<{ userId: string; startAt: Date }>) {
      const k = damascusDateStr(s.startAt)
      const bucket = daysByUser.get(s.userId)
      if (bucket) bucket.add(k)
      else daysByUser.set(s.userId, new Set([k]))
    }

    for (const emp of missingEmps) {
      const baseSalary = Number(emp.baseSalary || 0)
      const workingDays = emp.weeklyOffDay != null ? 6 : 7
      const daysWorked = daysByUser.get(emp.id)?.size || 0
      const effectiveDays = Math.min(daysWorked, workingDays)
      const proRated = baseSalary * effectiveDays / workingDays
      if (proRated > 0) {
        pendingPayrollCount += 1
        pendingPayrollAmount += proRated
      }
    }
  }

  // 3a) Pending bonuses persisted in BonusLog — count any row whose
  // week's payroll isn't paid yet.
  const paidKeySet = new Set(
    (paidUserWeeks as Array<{ userId: string; weekStart: Date }>).map(
      r => `${r.userId}|${r.weekStart.toISOString().slice(0, 10)}`,
    ),
  )

  let pendingBonusCount = 0
  let pendingBonusAmount = 0
  for (const b of bonusRows as Array<{ userId: string; weekStart: Date | null; amount: unknown }>) {
    const wk = b.weekStart ? b.weekStart.toISOString().slice(0, 10) : null
    const key = wk ? `${b.userId}|${wk}` : null
    if (!key || !paidKeySet.has(key)) {
      pendingBonusCount += 1
      pendingBonusAmount += Number(b.amount || 0)
    }
  }

  // 3b) Live cumulative bonus for the current week — these don't exist
  // in BonusLog until the explicit accrue endpoint runs, so without
  // this branch a streak of N clean weeks would silently show as
  // "0 معلّق" in the dues card. Computed via the batched helper to
  // keep the DB load to a single transaction.findMany roundtrip.
  const currentWeekKeySet = new Set(
    (currentWeekEntries as Array<{ userId: string; status: string }>)
      .filter(e => e.status === 'PAID')
      .map(e => e.userId),
  )
  const employeesForCum = (activeEmployees as Array<{ id: string; baseSalary: unknown; hireDate: Date | null; createdAt: Date; role: string | null }>)
    .filter(e => !currentWeekKeySet.has(e.id))
    .map(e => ({
      id: e.id,
      hireDate: e.hireDate,
      createdAt: e.createdAt,
      role: e.role,
      baseSalary: e.baseSalary != null ? Number(e.baseSalary) : null,
    }))
  if (employeesForCum.length > 0) {
    const cumByUser = await computeCumulativeBonusBatch(
      employeesForCum,
      currentWeekStart,
      { includeAnchorWeek: false },
    )
    for (const [uid, res] of cumByUser) {
      if (res.amount > 0) {
        pendingBonusCount += 1
        pendingBonusAmount += res.amount
      }
    }
  }

  return {
    pendingPayrollCount,
    pendingPayrollAmount,
    pendingBonusCount,
    pendingBonusAmount,
  }
}

// ─── Overview KPIs (4 hero tiles) ──────────────────────────────────────────
export async function computeKpis(from: Date, to: Date, scopedUserIds: string[] | null) {
  const handledFilter = scopedUserIds ? { in: scopedUserIds } : { not: null }
  const userIdFilter = scopedUserIds ? { in: scopedUserIds } : undefined

  const [paidPayrolls, bonusAgg, errorCount, complaintCount, employeeCount, txAgg] = await Promise.all([
    db.payrollEntry.aggregate({
      where: { status: 'PAID', paidAt: { gte: from, lte: to }, ...(userIdFilter ? { userId: userIdFilter } : {}) },
      _sum: { netAmount: true, baseSalary: true, bonusAmount: true, deductions: true },
      _count: { _all: true },
    }),
    db.bonusLog.groupBy({
      by: ['type'],
      where: { appliedAt: { gte: from, lte: to }, ...(userIdFilter ? { userId: userIdFilter } : {}) },
      _sum: { amount: true },
    }),
    db.transaction.count({
      where: {
        handledByUserId: handledFilter,
        txDateTime: { gte: from, lte: to },
        reviewCategory: { in: RESET_CATEGORIES as unknown as string[] },
      },
    }),
    db.transaction.count({
      where: {
        followUpAssignedTo: handledFilter,
        reviewCategory: 'COMPLAINT',
        txDateTime: { gte: from, lte: to },
      },
    }),
    db.user.count({ where: { isActive: true, ...(scopedUserIds ? { role: 'EMPLOYEE' } : {}) } }),
    db.transaction.groupBy({
      by: ['status'],
      where: {
        handledByUserId: handledFilter,
        txDateTime: { gte: from, lte: to },
      },
      _count: { _all: true },
    }),
  ])

  const bonusByType: Record<string, number> = {}
  for (const r of bonusAgg as Array<{ type: string; _sum: { amount: unknown } }>) {
    bonusByType[r.type] = Number(r._sum.amount || 0)
  }

  let totalHandled = 0
  let matchedHandled = 0
  for (const r of txAgg as Array<{ status: string; _count: { _all: number } }>) {
    totalHandled += r._count._all
    if (r.status === 'MATCHED') matchedHandled = r._count._all
  }
  const matchRate = totalHandled > 0 ? Math.round((matchedHandled / totalHandled) * 10000) / 100 : 0

  return {
    salaryPaid: Number(paidPayrolls._sum.netAmount || 0),
    salaryBase: Number(paidPayrolls._sum.baseSalary || 0),
    salaryDeductions: Number(paidPayrolls._sum.deductions || 0),
    salaryEntries: paidPayrolls._count._all,
    bonusGroup: bonusByType.GROUP || 0,
    bonusManual: bonusByType.MANUAL || 0,
    bonusCumulative: bonusByType.CUMULATIVE || 0,
    bonusTotal: (bonusByType.GROUP || 0) + (bonusByType.MANUAL || 0) + (bonusByType.CUMULATIVE || 0),
    errorCount,
    complaintCount,
    employeeCount,
    totalHandled,
    matchedHandled,
    matchRate,
  }
}

// ─── Scorecard rows (one per active employee) ─────────────────────────────
export async function computeScorecardRows(opts: { from: Date; to: Date; role: string }) {
  const { from, to, role } = opts
  // MANAGER only sees front-line EMPLOYEE staff; ADMIN/SUPERVISOR see all.
  const employeeWhere: Record<string, unknown> = { isActive: true }
  if (role === UserRole.MANAGER) employeeWhere.role = 'EMPLOYEE'

  const employees = await db.user.findMany({
    where: employeeWhere,
    select: {
      id: true, name: true, employeeCode: true, jobTitle: true, role: true,
      avatarUrl: true, baseSalary: true, hireDate: true, createdAt: true,
    },
    orderBy: { name: 'asc' },
  })

  const ws = startOfWeek(new Date())
  const empIds = employees.map((e: { id: string }) => e.id)

  const [txAggregate, complaintAggregate, bonusAggregate, latestPayrolls] = await Promise.all([
    db.transaction.groupBy({
      by: ['handledByUserId', 'status', 'reviewCategory'],
      where: {
        handledByUserId: { in: empIds },
        txDateTime: { gte: from, lte: to },
      },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    db.transaction.groupBy({
      by: ['followUpAssignedTo'],
      where: {
        followUpAssignedTo: { in: empIds },
        reviewCategory: 'COMPLAINT',
        txDateTime: { gte: from, lte: to },
      },
      _count: { _all: true },
    }),
    db.bonusLog.groupBy({
      by: ['userId', 'type'],
      where: { userId: { in: empIds }, appliedAt: { gte: from, lte: to } },
      _sum: { amount: true },
    }),
    db.payrollEntry.findMany({
      where: { userId: { in: empIds } },
      orderBy: { weekStart: 'desc' },
      distinct: ['userId'],
      select: {
        id: true, userId: true, netAmount: true, status: true, weekStart: true,
      },
    }),
  ])

  type TxAggRow = {
    handledByUserId: string | null
    status: string
    reviewCategory: string | null
    _count: { _all: number }
    _sum: { amount: unknown }
  }
  type ComplaintAggRow = { followUpAssignedTo: string | null; _count: { _all: number } }
  type BonusAggRow = { userId: string; type: string; _sum: { amount: unknown } }
  type LatestPayrollRow = { id: string; userId: string; netAmount: unknown; status: string; weekStart: Date }

  const txByUser = new Map<string, TxAggRow[]>()
  for (const r of txAggregate as TxAggRow[]) {
    if (!r.handledByUserId) continue
    const arr = txByUser.get(r.handledByUserId)
    if (arr) arr.push(r); else txByUser.set(r.handledByUserId, [r])
  }
  const complaintByUser = new Map<string, number>()
  for (const r of complaintAggregate as ComplaintAggRow[]) {
    if (r.followUpAssignedTo) complaintByUser.set(r.followUpAssignedTo, r._count._all)
  }
  const bonusByUser = new Map<string, { group: number; manual: number; cumulative: number }>()
  for (const r of bonusAggregate as BonusAggRow[]) {
    const cur = bonusByUser.get(r.userId) || { group: 0, manual: 0, cumulative: 0 }
    const amt = Number(r._sum.amount || 0)
    if (r.type === 'GROUP') cur.group += amt
    else if (r.type === 'MANUAL') cur.manual += amt
    else if (r.type === 'CUMULATIVE') cur.cumulative += amt
    bonusByUser.set(r.userId, cur)
  }
  const latestPayrollByUser = new Map<string, LatestPayrollRow>()
  for (const p of latestPayrolls as LatestPayrollRow[]) {
    latestPayrollByUser.set(p.userId, p)
  }

  // "As of last completed week" — same semantic as /api/payroll. The
  // current in-progress week is NOT pre-counted as a clean week; the
  // bonus accrues only after a full clean week elapses. Per-employee
  // role + baseSalary are forwarded so the active BonusRule can apply
  // its targetRoles filter and percent / tiered formulas correctly.
  const cumByUser = await computeCumulativeBonusBatch(
    employees.map((e: typeof employees[number]) => ({
      id: e.id,
      hireDate: e.hireDate ?? null,
      createdAt: e.createdAt,
      role: e.role,
      baseSalary: e.baseSalary != null ? Number(e.baseSalary) : null,
    })),
    ws,
    { includeAnchorWeek: false },
  )

  return employees.map((emp: typeof employees[number]) => {
    const txRows = txByUser.get(emp.id) || []
    let operationsHandled = 0
    let matchedCount = 0
    let discrepancyCount = 0
    let totalAmount = 0
    let errorCount = 0
    let theftCount = 0
    let wasteCount = 0
    for (const r of txRows) {
      operationsHandled += r._count._all
      totalAmount += Number(r._sum.amount || 0)
      if (r.status === 'MATCHED') matchedCount += r._count._all
      else if (r.status === 'DISCREPANCY') discrepancyCount += r._count._all
      if (r.reviewCategory === 'EMPLOYEE_ERROR') errorCount += r._count._all
      else if (r.reviewCategory === 'THEFT') theftCount += r._count._all
      else if (r.reviewCategory === 'WASTE') wasteCount += r._count._all
    }
    const matchRate = operationsHandled > 0
      ? Math.round((matchedCount / operationsHandled) * 10000) / 100
      : 0
    const cum = cumByUser.get(emp.id) || { cleanStreak: 0, amount: 0, lastErrorWeek: null }
    const bonuses = bonusByUser.get(emp.id) || { group: 0, manual: 0, cumulative: 0 }
    const latestPayroll = latestPayrollByUser.get(emp.id)

    return {
      id: emp.id,
      name: emp.name,
      employeeCode: emp.employeeCode,
      jobTitle: emp.jobTitle,
      role: emp.role,
      avatarUrl: emp.avatarUrl,
      baseSalary: emp.baseSalary != null ? Number(emp.baseSalary) : null,
      operationsHandled,
      matchedCount,
      discrepancyCount,
      totalAmount,
      errorCount,
      theftCount,
      wasteCount,
      complaintCount: complaintByUser.get(emp.id) || 0,
      matchRate,
      cumulativeStreak: cum.cleanStreak,
      cumulativeAmount: cum.amount,
      bonusGroup: bonuses.group,
      bonusManual: bonuses.manual,
      latestPayrollId: latestPayroll?.id ?? null,
      latestPayrollNet: latestPayroll ? Number(latestPayroll.netAmount) : 0,
      latestPayrollStatus: latestPayroll?.status ?? null,
      latestPayrollWeekStart: latestPayroll?.weekStart?.toISOString() ?? null,
    }
  })
}
