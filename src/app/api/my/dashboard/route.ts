import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'

// Module K — personal dashboard data for the logged-in employee.
function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const m = new Date(d); m.setDate(d.getDate() - day); m.setHours(0,0,0,0)
  return m
}

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const userId = session.userId
    const now = new Date()
    const ws = startOfWeek(now)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [user, currentSession, recentPayrolls, weekTxs, monthTxs, errorTxs, recentNotifs] = await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: {
          id: true, name: true, email: true, role: true,
          employeeCode: true, jobTitle: true, hireDate: true,
          baseSalary: true, avatarUrl: true, createdAt: true,
        },
      }),
      db.shiftSession.findFirst({
        where: { userId, status: { in: ['ACTIVE', 'PENDING_END', 'PENDING_START'] } },
        orderBy: { startAt: 'desc' },
      }),
      db.payrollEntry.findMany({
        where: { userId },
        orderBy: { weekStart: 'desc' },
        take: 4,
      }),
      db.transaction.count({
        where: { handledByUserId: userId, txDateTime: { gte: ws } },
      }),
      db.transaction.count({
        where: { handledByUserId: userId, txDateTime: { gte: monthStart } },
      }),
      db.transaction.count({
        where: {
          handledByUserId: userId,
          reviewCategory: { in: ['EMPLOYEE_ERROR', 'THEFT'] },
        },
      }),
      db.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ])

    // Cumulative bonus — computed LIVE. Walks back week-by-week from the
    // start of the current week, counting clean weeks (no errors) until
    // either an error week is found OR we reach the employee's hireDate.
    const CUMULATIVE_PER_WEEK = 5000
    const MAX_LOOKBACK_WEEKS = 24
    const hireBoundary = user?.hireDate
      ? new Date(user.hireDate)
      : (user?.createdAt ? new Date(user.createdAt) : null)
    if (hireBoundary) hireBoundary.setHours(0, 0, 0, 0)
    let cleanStreak = 0
    for (let w = 0; w < MAX_LOOKBACK_WEEKS; w++) {
      const wsBack = new Date(ws); wsBack.setDate(ws.getDate() - 7 * w)
      // Stop if this week starts before the employee was hired
      if (hireBoundary && wsBack < hireBoundary) break
      const weBack = new Date(wsBack); weBack.setDate(wsBack.getDate() + 7)
      const errCount = await db.transaction.count({
        where: {
          handledByUserId: userId,
          txDateTime: { gte: wsBack, lt: weBack },
          reviewCategory: { in: ['EMPLOYEE_ERROR', 'THEFT'] },
        },
      })
      if (errCount > 0) break
      cleanStreak++
    }
    const cumulativeBonusAmount = cleanStreak * CUMULATIVE_PER_WEEK

    return NextResponse.json({
      success: true,
      user: user ? {
        ...user,
        baseSalary: user.baseSalary ? Number(user.baseSalary) : null,
      } : null,
      currentSession,
      payrolls: recentPayrolls.map((p: typeof recentPayrolls[0]) => ({
        ...p,
        baseSalary: Number(p.baseSalary),
        bonusAmount: Number(p.bonusAmount),
        netAmount: Number(p.netAmount),
        advanceAmount: Number(p.advanceAmount),
        workedHours: Number(p.workedHours),
      })),
      stats: {
        operationsThisWeek: weekTxs,
        operationsThisMonth: monthTxs,
        errorsTotal: errorTxs,
        cumulativeBonus: cumulativeBonusAmount,
        cumulativeWeeks: cleanStreak,
        cumulativeWeekStart: ws.toISOString(),
      },
      recentActivity: recentNotifs.map((a: typeof recentNotifs[0]) => ({
        id: a.id,
        action: a.action,
        entity: a.entity,
        createdAt: a.createdAt,
      })),
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
