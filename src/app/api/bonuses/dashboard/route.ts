import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

// Aggregated bonus data for the bonuses dashboard.
//
// For each active employee, returns:
//   - cumulative bonus (live-computed clean-week streak × 5,000)
//   - total GROUP bonuses received in the selected period
//   - total MANUAL bonuses received in the selected period
//   - error count in the period (errors that would have reset the cumulative)
//   - error count in the lookback that DID reset (week immediately before streak)
//
// Query params:
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD → date range (default = last 30 days)

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const m = new Date(d); m.setDate(d.getDate() - day); m.setHours(0, 0, 0, 0)
  return m
}

const CUMULATIVE_PER_WEEK = 5000
const MAX_LOOKBACK_WEEKS = 24

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

  const params = req.nextUrl.searchParams
  const fromParam = params.get('from')
  const toParam = params.get('to')
  const from = fromParam ? new Date(fromParam) : new Date(Date.now() - 30 * 86_400_000)
  const to = toParam ? new Date(toParam) : new Date()
  from.setHours(0, 0, 0, 0)
  to.setHours(23, 59, 59, 999)

  const employees = await db.user.findMany({
    where: { isActive: true },
    select: {
      id: true, name: true, jobTitle: true, employeeCode: true, avatarUrl: true,
      hireDate: true, createdAt: true,
    },
    orderBy: { name: 'asc' },
  })

  const ws = startOfWeek(new Date())

  const rows: Array<Record<string, unknown>> = []
  for (const emp of employees) {
    const startBoundary = emp.hireDate ? new Date(emp.hireDate) : new Date(emp.createdAt)
    startBoundary.setHours(0, 0, 0, 0)

    // Live cumulative streak
    let cleanStreak = 0
    let nextErrorWeek: Date | null = null
    for (let w = 0; w < MAX_LOOKBACK_WEEKS; w++) {
      const wsBack = new Date(ws); wsBack.setDate(ws.getDate() - 7 * w)
      if (wsBack < startBoundary) break
      const weBack = new Date(wsBack); weBack.setDate(wsBack.getDate() + 7)
      const errCount = await db.transaction.count({
        where: {
          handledByUserId: emp.id,
          txDateTime: { gte: wsBack, lt: weBack },
          reviewCategory: { in: ['EMPLOYEE_ERROR', 'THEFT'] },
        },
      })
      if (errCount > 0) {
        nextErrorWeek = wsBack
        break
      }
      cleanStreak++
    }
    const cumulativeAmount = cleanStreak * CUMULATIVE_PER_WEEK

    // GROUP / MANUAL bonuses in the selected period
    const [groupSum, manualSum, count] = await Promise.all([
      db.bonusLog.aggregate({
        where: { userId: emp.id, type: 'GROUP', appliedAt: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
      db.bonusLog.aggregate({
        where: { userId: emp.id, type: 'MANUAL', appliedAt: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
      db.bonusLog.count({
        where: { userId: emp.id, appliedAt: { gte: from, lte: to }, type: { in: ['GROUP', 'MANUAL'] } },
      }),
    ])
    const groupAmount = Number(groupSum._sum.amount || 0)
    const manualAmount = Number(manualSum._sum.amount || 0)

    // Errors in the period (informational)
    const periodErrors = await db.transaction.count({
      where: {
        handledByUserId: emp.id,
        txDateTime: { gte: from, lte: to },
        reviewCategory: { in: ['EMPLOYEE_ERROR', 'THEFT'] },
      },
    })

    // Pull individual bonus entries for this employee in the period (for the
    // expandable detail panel + delete actions).
    const empBonuses = await db.bonusLog.findMany({
      where: {
        userId: emp.id,
        type: { in: ['GROUP', 'MANUAL'] },
        appliedAt: { gte: from, lte: to },
      },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { appliedAt: 'desc' },
    })

    // Determine which bonuses are paid (their week's payroll = PAID)
    const bonusesWithPaid = await Promise.all(
      empBonuses.map(async (b: typeof empBonuses[0]) => {
        let isPaid = false
        if (b.weekStart) {
          const paid = await db.payrollEntry.findFirst({
            where: { userId: emp.id, weekStart: b.weekStart, status: 'PAID' },
            select: { id: true },
          })
          isPaid = !!paid
        }
        return {
          id: b.id,
          type: b.type,
          amount: Number(b.amount),
          reason: b.reason,
          appliedAt: b.appliedAt,
          weekStart: b.weekStart,
          createdBy: b.createdBy,
          isPaid,
        }
      })
    )

    rows.push({
      id: emp.id,
      name: emp.name,
      jobTitle: emp.jobTitle,
      employeeCode: emp.employeeCode,
      avatarUrl: emp.avatarUrl,
      cumulativeAmount,
      cumulativeWeeks: cleanStreak,
      lastErrorWeek: nextErrorWeek?.toISOString() || null,
      groupAmount,
      manualAmount,
      manualBonusCount: count,
      total: cumulativeAmount + groupAmount + manualAmount,
      periodErrors,
      bonuses: bonusesWithPaid,
    })
  }

  // Recent bonus history (last 20 GROUP/MANUAL entries in period)
  const recent = await db.bonusLog.findMany({
    where: {
      type: { in: ['GROUP', 'MANUAL'] },
      appliedAt: { gte: from, lte: to },
    },
    include: {
      user: { select: { id: true, name: true, employeeCode: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { appliedAt: 'desc' },
    take: 20,
  })

  // Determine which bonuses are "paid" — i.e. the user's payroll for that
  // bonus's week is already PAID. Paid bonuses can't be deleted.
  const weekKeys = Array.from(new Set(
    recent.flatMap((r: typeof recent[0]) => r.weekStart ? [`${r.userId}|${r.weekStart.toISOString()}`] : []),
  )) as string[]
  const paidSet = new Set<string>()
  if (weekKeys.length > 0) {
    const paidEntries = await db.payrollEntry.findMany({
      where: {
        status: 'PAID',
        OR: weekKeys.map(k => {
          const [uid, ws] = k.split('|')
          return { userId: uid, weekStart: new Date(ws) }
        }),
      },
      select: { userId: true, weekStart: true },
    })
    for (const p of paidEntries) {
      paidSet.add(`${p.userId}|${p.weekStart.toISOString()}`)
    }
  }

  return NextResponse.json({
    success: true,
    from: from.toISOString(),
    to: to.toISOString(),
    employees: rows,
    recent: recent.map((r: typeof recent[0]) => ({
      id: r.id,
      type: r.type,
      amount: Number(r.amount),
      reason: r.reason,
      appliedAt: r.appliedAt,
      user: r.user,
      createdBy: r.createdBy,
      isPaid: r.weekStart ? paidSet.has(`${r.userId}|${r.weekStart.toISOString()}`) : false,
    })),
  })
}
