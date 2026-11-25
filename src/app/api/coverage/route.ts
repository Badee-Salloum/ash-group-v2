// Phase F — list CoverageAssignment rows for a date range.

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { dateColumnUtc, damascusDateStr } from '@/lib/datetime'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function validDateOnly(value: string | null): value is string {
  if (!value || !DATE_ONLY.test(value)) return false
  const parsed = dateColumnUtc(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const from = req.nextUrl.searchParams.get('from')
    const to = req.nextUrl.searchParams.get('to')

    if ((from && !validDateOnly(from)) || (to && !validDateOnly(to)) || (from && to && from > to)) {
      return NextResponse.json({ error: 'نطاق التاريخ غير صالح' }, { status: 400 })
    }

    const where: Record<string, unknown> = {}
    if (from && to) {
      where.date = { gte: dateColumnUtc(from), lte: dateColumnUtc(to) }
    } else if (from) {
      where.date = { gte: dateColumnUtc(from) }
    } else if (to) {
      where.date = { lte: dateColumnUtc(to) }
    }

    // A branch manager owns the active EMPLOYEE roster as a whole. managerId
    // is optional and is not assigned by every employee-creation flow, so it
    // must not be used as the branch boundary here.
    if (session.role === UserRole.MANAGER) {
      const subs = await db.user.findMany({
        where: { isActive: true, role: UserRole.EMPLOYEE },
        select: { id: true },
      })
      const ids = subs.map((s: { id: string }) => s.id)
      if (ids.length === 0) return NextResponse.json({ success: true, data: [] })
      where.userId = { in: ids }
    }

    const rows = await db.coverageAssignment.findMany({
      where: where as never,
      include: {
        user: { select: { id: true, name: true, employeeCode: true } },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      take: 2000,
    })

    // Resolve coverForUserId names in a single batched lookup.
    type Row = {
      id: string; userId: string; date: Date; startTime: string; endTime: string
      originalShiftId: string | null; coverForUserId: string | null
      user: { id: string; name: string; employeeCode: string | null } | null
    }
    const coverForIds = Array.from(new Set(
      (rows as Row[]).map(r => r.coverForUserId).filter((v): v is string => Boolean(v)),
    ))
    const coverForMap = new Map<string, { id: string; name: string }>()
    if (coverForIds.length > 0) {
      const users = await db.user.findMany({
        where: { id: { in: coverForIds } },
        select: { id: true, name: true },
      })
      for (const u of users as Array<{ id: string; name: string }>) coverForMap.set(u.id, u)
    }

    const data = (rows as Row[]).map(r => ({
      id: r.id,
      userId: r.userId,
      date: damascusDateStr(r.date),
      startTime: r.startTime,
      endTime: r.endTime,
      originalShiftId: r.originalShiftId,
      coverForUserId: r.coverForUserId,
      user: r.user,
      coverFor: r.coverForUserId ? coverForMap.get(r.coverForUserId) ?? null : null,
    }))

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
