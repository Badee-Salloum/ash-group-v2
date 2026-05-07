import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

// Attendance matrix — one row per active employee, one cell per day in the
// selected week. Each cell summarises that day's shift sessions.
//
// Available to: ADMIN, MANAGER, SUPERVISOR. Other roles get 403.

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const m = new Date(d); m.setDate(d.getDate() - day); m.setHours(0, 0, 0, 0)
  return m
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  requireRole(session, [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPERVISOR])

  const params = req.nextUrl.searchParams
  const ws = params.get('weekStart')
    ? startOfWeek(new Date(params.get('weekStart')!))
    : startOfWeek(new Date())
  const we = new Date(ws); we.setDate(ws.getDate() + 7); we.setHours(0, 0, 0, 0)

  // Attendance page tracks daily presence for EMPLOYEE-tier accounts only.
  // Managers, supervisors, account managers, admins aren't "shift workers"
  // and don't appear here.
  const employees = await db.user.findMany({
    where: { isActive: true, role: UserRole.EMPLOYEE },
    select: {
      id: true, name: true, jobTitle: true, employeeCode: true, avatarUrl: true, role: true,
    },
    orderBy: [{ jobTitle: 'asc' }, { name: 'asc' }],
  })

  const sessions = await db.shiftSession.findMany({
    where: {
      userId: { in: employees.map((e: { id: string }) => e.id) },
      startAt: { gte: ws, lt: we },
    },
    select: {
      id: true, userId: true, startAt: true, endAt: true,
      durationMinutes: true, status: true, shiftNumber: true,
    },
    orderBy: { startAt: 'asc' },
  })

  // Group sessions by user → by day-of-week (0..6)
  const matrix = new Map<string, Array<typeof sessions>>()
  for (const e of employees) matrix.set(e.id, Array.from({ length: 7 }, () => [] as typeof sessions))
  for (const s of sessions) {
    const dayIdx = Math.max(0, Math.min(6, Math.floor((new Date(s.startAt).getTime() - ws.getTime()) / 86_400_000)))
    matrix.get(s.userId)?.[dayIdx].push(s)
  }

  const data = employees.map((emp: typeof employees[0]) => {
    const dayCells = matrix.get(emp.id) || []
    let weekMinutes = 0
    const days = dayCells.map((daySessions, idx) => {
      const totalMinutes = daySessions.reduce((s: number, x: typeof daySessions[0]) => {
        if (x.durationMinutes) return s + x.durationMinutes
        if (x.endAt) return s + Math.round((new Date(x.endAt).getTime() - new Date(x.startAt).getTime()) / 60000)
        if (x.status === 'ACTIVE' || x.status === 'PENDING_END') {
          return s + Math.round((Date.now() - new Date(x.startAt).getTime()) / 60000)
        }
        return s
      }, 0)
      weekMinutes += totalMinutes
      const date = new Date(ws); date.setDate(ws.getDate() + idx)
      const isActive = daySessions.some((x: typeof daySessions[0]) => x.status === 'ACTIVE' || x.status === 'PENDING_END')
      const isComplete = daySessions.length > 0 && !isActive
      return {
        dayIndex: idx,
        date: date.toISOString().slice(0, 10),
        sessionsCount: daySessions.length,
        totalMinutes,
        isActive,
        isComplete,
        sessions: daySessions.map((x: typeof daySessions[0]) => ({
          id: x.id,
          startAt: x.startAt,
          endAt: x.endAt,
          status: x.status,
          shiftNumber: x.shiftNumber,
          durationMinutes: x.durationMinutes,
        })),
      }
    })
    return {
      ...emp,
      weekMinutes,
      days,
    }
  })

  return NextResponse.json({
    success: true,
    weekStart: ws.toISOString(),
    weekEnd: new Date(we.getTime() - 1).toISOString(),
    employees: data,
  })
}
