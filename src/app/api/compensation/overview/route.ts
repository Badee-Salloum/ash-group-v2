import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { computeKpis } from '@/lib/compensation/aggregates'

// GET /api/compensation/overview?from=YYYY-MM-DD&to=YYYY-MM-DD&compare=true
//
// Roll-up KPIs for the compensation dashboard: total salary paid, total
// bonuses (group + manual + cumulative paid via payroll), error and
// complaint counts attributed to employees, headcount, and average match
// rate across employees with operations in the period.
//
// When `?compare=true`, also returns `previous`: the same KPIs computed
// over the period immediately preceding the requested window (same length),
// so the client can render delta indicators.

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPERVISOR])

    const params = req.nextUrl.searchParams
    const fromParam = params.get('from')
    const toParam = params.get('to')
    const compare = params.get('compare') === 'true'

    const from = fromParam ? new Date(fromParam) : new Date(Date.now() - 30 * 86_400_000)
    const to = toParam ? new Date(toParam) : new Date()
    from.setHours(0, 0, 0, 0)
    to.setHours(23, 59, 59, 999)

    // MANAGER scopes every KPI to EMPLOYEE-handled transactions only.
    let scopedUserIds: string[] | null = null
    if (session.role === UserRole.MANAGER) {
      const empUsers = await db.user.findMany({
        where: { isActive: true, role: 'EMPLOYEE' },
        select: { id: true },
      })
      scopedUserIds = empUsers.map((u: { id: string }) => u.id)
    }

    const kpis = await computeKpis(from, to, scopedUserIds)
    let previous: Awaited<ReturnType<typeof computeKpis>> | null = null
    if (compare) {
      const lengthMs = to.getTime() - from.getTime()
      const prevTo = new Date(from.getTime() - 1)
      const prevFrom = new Date(prevTo.getTime() - lengthMs)
      prevFrom.setHours(0, 0, 0, 0)
      prevTo.setHours(23, 59, 59, 999)
      previous = await computeKpis(prevFrom, prevTo, scopedUserIds)
    }

    return NextResponse.json({
      success: true,
      period: { from: from.toISOString(), to: to.toISOString() },
      kpis,
      previous,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
