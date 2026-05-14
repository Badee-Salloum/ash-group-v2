import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { buildPlannedMatrix, derivePlannedFields } from '@/lib/attendance/planned'
import { weekStartStr, weekDays, damascusDayStartUtc, damascusDateStr, addDays } from '@/lib/datetime'

// Attendance matrix — one row per active employee, one cell per day in the
// selected week. Each cell summarises that day's shift sessions.
//
// Available to: ADMIN, MANAGER, SUPERVISOR. Other roles get 403.
//
// All week/day math runs on YYYY-MM-DD calendar strings in Damascus time
// (see lib/datetime). The previous implementation used `Date` + getDay() +
// toISOString(), which silently shifted the week back a day on a UTC server
// vs. a UTC+3 client — so the query window missed the real sessions and the
// grid looked empty.

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  requireRole(session, [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPERVISOR])

  const params = req.nextUrl.searchParams
  // Normalize whatever the client sent to the canonical Sunday of that week.
  const ws = weekStartStr(params.get('weekStart') || new Date())
  const dayKeys = weekDays(ws) // 7 × YYYY-MM-DD
  // DB query window: [Sunday 00:00 Damascus, next Sunday 00:00 Damascus).
  const windowStart = damascusDayStartUtc(dayKeys[0])
  const windowEnd = damascusDayStartUtc(addDays(dayKeys[6], 1))

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

  const employeeIds = employees.map((e: { id: string }) => e.id)

  const sessions = await db.shiftSession.findMany({
    where: {
      userId: { in: employeeIds },
      startAt: { gte: windowStart, lt: windowEnd },
    },
    select: {
      id: true, userId: true, startAt: true, endAt: true,
      durationMinutes: true, status: true, shiftNumber: true,
    },
    orderBy: { startAt: 'asc' },
  })

  // Planned roster for the same week — so the matrix shows who is *supposed*
  // to be on each shift even before anyone checks in. Without this the page
  // is blank until the first check-in of the week.
  const plannedShifts = await db.shift.findMany({
    where: {
      userId: { in: employeeIds },
      date: { gte: damascusDayStartUtc(dayKeys[0]), lt: windowEnd },
    },
    select: { userId: true, date: true, shiftNumber: true, isDayOff: true },
  })
  const planned = buildPlannedMatrix(plannedShifts, employeeIds, dayKeys)

  // Group sessions by user → by day index, bucketed on the session's Damascus
  // calendar date matched against this week's 7 day-strings.
  const matrix = new Map<string, Array<typeof sessions>>()
  for (const e of employees) matrix.set(e.id, Array.from({ length: 7 }, () => [] as typeof sessions))
  for (const s of sessions) {
    const dayIdx = dayKeys.indexOf(damascusDateStr(s.startAt))
    if (dayIdx >= 0) matrix.get(s.userId)?.[dayIdx].push(s)
  }

  const data = employees.map((emp: typeof employees[0]) => {
    const dayCells = matrix.get(emp.id) || []
    const plannedRow = planned.get(emp.id) || []
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
      const isActive = daySessions.some((x: typeof daySessions[0]) => x.status === 'ACTIVE' || x.status === 'PENDING_END')
      const isComplete = daySessions.length > 0 && !isActive
      const { plannedShift, plannedDayOff } = derivePlannedFields(plannedRow[idx])
      return {
        dayIndex: idx,
        date: dayKeys[idx],
        sessionsCount: daySessions.length,
        totalMinutes,
        isActive,
        isComplete,
        // Planned roster for this day (null when nothing scheduled). The UI
        // renders this as a faint hint behind actual attendance.
        plannedShift,
        plannedDayOff,
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
    weekStart: dayKeys[0],
    weekEnd: dayKeys[6],
    employees: data,
  })
}
