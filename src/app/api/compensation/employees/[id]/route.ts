import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import {
  computeCumulativeBonus,
  RESET_CATEGORIES,
} from '@/lib/compensation/cumulativeBonus'

// GET /api/compensation/employees/[id]?weeks=12
//
// Per-employee detail for the compensation portal: weekly trend
// (matched / errors / net pay), bonus history, payroll history, recent
// fault transactions, and active follow-up assignments.

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const m = new Date(d); m.setDate(d.getDate() - day); m.setHours(0, 0, 0, 0)
  return m
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPERVISOR])

    const userId = params.id
    const employee = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, employeeCode: true, jobTitle: true, role: true,
        avatarUrl: true, baseSalary: true, hireDate: true, createdAt: true,
        email: true, phone: true, address: true, managerId: true,
      },
    })
    if (!employee) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 })
    }
    // MANAGER may only inspect EMPLOYEE-tier staff; viewing a SUPERVISOR or
    // ADMIN profile is restricted to ADMIN.
    if (session.role === UserRole.MANAGER && employee.role !== 'EMPLOYEE') {
      return NextResponse.json(
        { error: 'مدير الفرع يستطيع رؤية الموظفين فقط' },
        { status: 403 },
      )
    }

    const weeks = Math.min(52, Math.max(4, parseInt(req.nextUrl.searchParams.get('weeks') || '12')))
    const ws = startOfWeek(new Date())

    // 1) Weekly trend — for each of the last `weeks` weeks, count matched
    // transactions, error transactions, and pull the PayrollEntry netAmount.
    const trendWeeks: Date[] = []
    for (let w = weeks - 1; w >= 0; w--) {
      const d = new Date(ws); d.setDate(ws.getDate() - 7 * w)
      trendWeeks.push(d)
    }
    const earliestWeek = trendWeeks[0]
    const latestWeekEnd = new Date(trendWeeks[trendWeeks.length - 1])
    latestWeekEnd.setDate(latestWeekEnd.getDate() + 7)

    const [weeklyMatched, weeklyErrors, weeklyPayrolls] = await Promise.all([
      db.transaction.findMany({
        where: {
          handledByUserId: userId,
          status: 'MATCHED',
          txDateTime: { gte: earliestWeek, lt: latestWeekEnd },
        },
        select: { txDateTime: true },
      }),
      db.transaction.findMany({
        where: {
          handledByUserId: userId,
          reviewCategory: { in: RESET_CATEGORIES as unknown as string[] },
          txDateTime: { gte: earliestWeek, lt: latestWeekEnd },
        },
        select: { txDateTime: true, reviewCategory: true },
      }),
      db.payrollEntry.findMany({
        where: { userId, weekStart: { gte: earliestWeek } },
        orderBy: { weekStart: 'asc' },
      }),
    ])

    function bucketByWeek<T extends { txDateTime: Date }>(rows: T[]): Map<string, number> {
      const map = new Map<string, number>()
      for (const r of rows) {
        for (let i = 0; i < trendWeeks.length; i++) {
          const wsStart = trendWeeks[i]
          const wsEnd = new Date(wsStart); wsEnd.setDate(wsStart.getDate() + 7)
          if (r.txDateTime >= wsStart && r.txDateTime < wsEnd) {
            const k = wsStart.toISOString().slice(0, 10)
            map.set(k, (map.get(k) || 0) + 1)
            break
          }
        }
      }
      return map
    }
    const matchedByWeek = bucketByWeek(weeklyMatched as Array<{ txDateTime: Date }>)
    const errorsByWeek = bucketByWeek(weeklyErrors as Array<{ txDateTime: Date }>)
    const payrollByWeek = new Map<string, number>()
    for (const p of weeklyPayrolls as Array<{ weekStart: Date; netAmount: unknown }>) {
      payrollByWeek.set(p.weekStart.toISOString().slice(0, 10), Number(p.netAmount))
    }
    const weeklyTrend = trendWeeks.map(d => {
      const k = d.toISOString().slice(0, 10)
      return {
        weekStart: d.toISOString(),
        matched: matchedByWeek.get(k) || 0,
        errors: errorsByWeek.get(k) || 0,
        net: payrollByWeek.get(k) || 0,
      }
    })

    // 2) Live cumulative streak — "as of last completed week" so the
    // in-progress week doesn't pre-credit the streak. Role + baseSalary
    // forwarded for BonusRule targetRoles + PERCENT/TIERED formulas.
    const cum = await computeCumulativeBonus(
      {
        id: employee.id,
        hireDate: employee.hireDate ?? null,
        createdAt: employee.createdAt,
        role: employee.role,
        baseSalary: employee.baseSalary != null ? Number(employee.baseSalary) : null,
      },
      ws,
      { includeAnchorWeek: false },
    )

    // 3) Detail lists — bonus history, payroll history, recent errors,
    // active follow-ups.
    const [bonusHistory, payrollHistory, recentErrors, assignedFollowUps] = await Promise.all([
      db.bonusLog.findMany({
        where: { userId },
        include: { createdBy: { select: { id: true, name: true } } },
        orderBy: { appliedAt: 'desc' },
        take: 50,
      }),
      db.payrollEntry.findMany({
        where: { userId },
        orderBy: { weekStart: 'desc' },
        take: 26,
      }),
      db.transaction.findMany({
        where: {
          handledByUserId: userId,
          reviewCategory: { in: ['EMPLOYEE_ERROR', 'THEFT', 'WASTE'] },
        },
        include: {
          account: { select: { name: true, currency: true } },
          batch: { select: { id: true, batchDate: true, createdAt: true, uploader: { select: { name: true } } } },
        },
        orderBy: { txDateTime: 'desc' },
        take: 20,
      }),
      db.transaction.findMany({
        where: {
          followUpAssignedTo: userId,
          followUpStatus: { in: ['OPEN', 'IN_PROGRESS'] },
        },
        include: {
          account: { select: { name: true } },
        },
        orderBy: { reviewedAt: 'asc' },
        take: 50,
      }),
    ])

    // 4) Period-level KPI (last 30 days) for the small cards at the top of
    // the detail page — separate from the weekly trend.
    const periodFrom = new Date(Date.now() - 30 * 86_400_000)
    periodFrom.setHours(0, 0, 0, 0)
    const [periodTxAgg, periodComplaintCount] = await Promise.all([
      db.transaction.groupBy({
        by: ['status'],
        where: { handledByUserId: userId, txDateTime: { gte: periodFrom } },
        _count: { _all: true },
      }),
      db.transaction.count({
        where: {
          followUpAssignedTo: userId,
          reviewCategory: 'COMPLAINT',
          txDateTime: { gte: periodFrom },
        },
      }),
    ])
    let periodOps = 0, periodMatched = 0, periodErrors = 0
    for (const r of periodTxAgg as Array<{ status: string; _count: { _all: number } }>) {
      periodOps += r._count._all
      if (r.status === 'MATCHED') periodMatched = r._count._all
    }
    periodErrors = recentErrors.filter((t: { txDateTime: Date }) => t.txDateTime >= periodFrom).length

    return NextResponse.json({
      success: true,
      employee: {
        ...employee,
        baseSalary: employee.baseSalary != null ? Number(employee.baseSalary) : null,
      },
      kpis: {
        operationsHandled: periodOps,
        matchedCount: periodMatched,
        matchRate: periodOps > 0 ? Math.round((periodMatched / periodOps) * 10000) / 100 : 0,
        errorCount: periodErrors,
        complaintCount: periodComplaintCount,
        cumulativeStreak: cum.cleanStreak,
        cumulativeAmount: cum.amount,
        lastErrorWeek: cum.lastErrorWeek?.toISOString() ?? null,
      },
      weeklyTrend,
      bonusHistory: bonusHistory.map((b: typeof bonusHistory[number]) => ({
        ...b,
        amount: Number(b.amount),
        appliedAt: b.appliedAt?.toISOString() ?? null,
        weekStart: b.weekStart?.toISOString() ?? null,
        createdAt: b.createdAt.toISOString(),
      })),
      payrollHistory: payrollHistory.map((p: typeof payrollHistory[number]) => ({
        ...p,
        baseSalary: Number(p.baseSalary),
        workedHours: Number(p.workedHours),
        expectedHours: Number(p.expectedHours),
        bonusAmount: Number(p.bonusAmount),
        advanceAmount: Number(p.advanceAmount),
        deductions: Number(p.deductions),
        netAmount: Number(p.netAmount),
        weekStart: p.weekStart.toISOString(),
        weekEnd: p.weekEnd.toISOString(),
        paidAt: p.paidAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
      recentErrors: recentErrors.map((t: typeof recentErrors[number]) => ({
        id: t.id,
        txDateTime: t.txDateTime.toISOString(),
        amount: Number(t.amount),
        currency: t.currency,
        status: t.status,
        type: t.type,
        source: t.source,
        reviewCategory: t.reviewCategory,
        reviewNotes: t.reviewNotes,
        shamCashTxId: t.shamCashTxId,
        platformTxId: t.platformTxId,
        account: t.account,
        batch: t.batch ? {
          id: t.batch.id,
          batchDate: t.batch.batchDate?.toISOString() ?? null,
          createdAt: t.batch.createdAt?.toISOString() ?? null,
          uploaderName: t.batch.uploader?.name ?? null,
        } : null,
      })),
      assignedFollowUps: assignedFollowUps.map((t: typeof assignedFollowUps[number]) => ({
        id: t.id,
        txDateTime: t.txDateTime.toISOString(),
        amount: Number(t.amount),
        currency: t.currency,
        reviewCategory: t.reviewCategory,
        followUpStatus: t.followUpStatus,
        reviewedAt: t.reviewedAt?.toISOString() ?? null,
        accountName: t.account.name,
      })),
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
