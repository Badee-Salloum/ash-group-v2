import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

// HR-focused dashboard for branch managers (MANAGER) — no financial figures.
// Returns:
//   - employee counts (total / active today)
//   - currently-working sessions (status ACTIVE) with names
//   - pending handovers waiting for manager approval
//   - pending advance requests
//   - this-week bonuses given (count + total amount)
//   - this-week attendance summary (worked-day counts)
//   - upcoming shifts (today + tomorrow)
export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    // Available to ADMIN as well so they can preview the manager view.
    if (session.role !== UserRole.MANAGER && session.role !== UserRole.ADMIN) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 })
    }

    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay()) // Sunday
    weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 7)

    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
    const tomorrowEnd = new Date(todayStart); tomorrowEnd.setDate(todayStart.getDate() + 2)

    const [
      totalEmployees,
      activeSessions,
      pendingHandovers,
      bonusAgg,
      bonusCount,
      weekSessions,
      upcomingShifts,
    ] = await Promise.all([
      db.user.count({ where: { isActive: true, role: UserRole.EMPLOYEE } }),
      db.shiftSession.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true, startAt: true, shiftNumber: true,
          user: { select: { id: true, name: true, jobTitle: true, avatarUrl: true } },
        },
        orderBy: { startAt: 'desc' },
        take: 50,
      }),
      db.shiftSession.findMany({
        where: { status: 'PENDING_START' },
        select: {
          id: true, startAt: true, shiftNumber: true, handoverFromUserId: true,
          user: { select: { id: true, name: true, jobTitle: true, avatarUrl: true } },
        },
        orderBy: { startAt: 'asc' },
        take: 20,
      }),
      db.bonusLog.aggregate({
        where: { weekStart: { gte: weekStart, lt: weekEnd } },
        _sum: { amount: true },
      }),
      db.bonusLog.count({
        where: { weekStart: { gte: weekStart, lt: weekEnd } },
      }),
      db.shiftSession.findMany({
        where: {
          status: { in: ['COMPLETED', 'ACTIVE', 'PENDING_END'] },
          startAt: { gte: weekStart, lt: weekEnd },
        },
        select: { userId: true, startAt: true },
      }),
      db.shift.findMany({
        where: { date: { gte: todayStart, lt: tomorrowEnd } },
        select: {
          id: true, date: true, shiftNumber: true, isDayOff: true,
          user: { select: { id: true, name: true, jobTitle: true, avatarUrl: true } },
        },
        orderBy: [{ date: 'asc' }, { shiftNumber: 'asc' }],
      }),
    ])

    // Per-employee worked-days this week
    const dayMap = new Map<string, Set<string>>()
    for (const s of weekSessions) {
      const key = new Date(s.startAt).toISOString().slice(0, 10)
      if (!dayMap.has(s.userId)) dayMap.set(s.userId, new Set())
      dayMap.get(s.userId)!.add(key)
    }
    const attendanceTotal = Array.from(dayMap.values()).reduce((s, set) => s + set.size, 0)
    const attendanceUniqueEmployees = dayMap.size

    return NextResponse.json({
      success: true,
      data: {
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        counts: {
          totalEmployees,
          currentlyWorking: activeSessions.length,
          pendingHandovers: pendingHandovers.length,
          bonusesThisWeekCount: bonusCount,
          bonusesThisWeekAmount: Number(bonusAgg._sum.amount || 0),
          attendanceTotalDays: attendanceTotal,
          attendanceActiveEmployees: attendanceUniqueEmployees,
        },
        activeSessions,
        pendingHandovers,
        upcomingShifts,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
