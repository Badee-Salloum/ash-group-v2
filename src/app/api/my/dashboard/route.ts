import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { computeCumulativeBonus } from '@/lib/compensation/cumulativeBonus'
import { damascusDateStr } from '@/lib/datetime'

// Module K — personal dashboard data for the logged-in employee.
function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const m = new Date(d); m.setDate(d.getDate() - day); m.setHours(0,0,0,0)
  return m
}

function endOfWeek(d: Date): Date {
  const e = startOfWeek(d)
  e.setDate(e.getDate() + 7)
  return e
}

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const userId = session.userId
    const now = new Date()
    const ws = startOfWeek(now)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const we = endOfWeek(now)
    const [user, currentSession, recentPayrolls, weekTxs, monthTxs, errorTxs, recentNotifs, weekCoverages] = await Promise.all([
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
      // Phase F — coverage half-shifts this user is assigned to this week.
      // Used to show extended hours on /my.
      db.coverageAssignment.findMany({
        where: { userId, date: { gte: ws, lt: we } },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      }),
    ])

    // Resolve coverFor names in one batched lookup so /my can show
    // "+4h لتغطية فلان".
    type CovRow = {
      id: string; userId: string; date: Date; startTime: string; endTime: string
      coverForUserId: string | null
    }
    const coverForIds = Array.from(new Set(
      (weekCoverages as CovRow[]).map(c => c.coverForUserId).filter((v): v is string => Boolean(v)),
    ))
    const coverForMap = new Map<string, string>()
    if (coverForIds.length > 0) {
      const u = await db.user.findMany({
        where: { id: { in: coverForIds } },
        select: { id: true, name: true },
      })
      for (const x of u as Array<{ id: string; name: string }>) coverForMap.set(x.id, x.name)
    }

    // Cumulative bonus — shared helper, "as of last completed week"
    // so the in-progress week doesn't pre-credit the streak before
    // it's actually finished. Role + baseSalary flow through so the
    // active BonusRule's targetRoles/PERCENT/TIERED apply correctly.
    const cum = user
      ? await computeCumulativeBonus(
          {
            id: user.id,
            hireDate: user.hireDate ?? null,
            createdAt: user.createdAt,
            role: user.role,
            baseSalary: user.baseSalary != null ? Number(user.baseSalary) : null,
          },
          ws,
          { includeAnchorWeek: false },
        )
      : { cleanStreak: 0, amount: 0, lastErrorWeek: null }
    const cleanStreak = cum.cleanStreak
    const cumulativeBonusAmount = cum.amount

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
      coverages: (weekCoverages as CovRow[]).map(c => ({
        id: c.id,
        date: damascusDateStr(c.date),
        startTime: c.startTime,
        endTime: c.endTime,
        coverForName: c.coverForUserId ? coverForMap.get(c.coverForUserId) ?? null : null,
      })),
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
