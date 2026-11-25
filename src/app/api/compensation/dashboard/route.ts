// /api/compensation/dashboard — single endpoint that combines the work of
// /overview, /employees and /trend. The frontend used to fire three
// separate requests in parallel; each one paid its own cold-start tax on
// Vercel + a fresh Neon connection. This route does the same Promise.all
// server-side so the client only opens ONE connection.

import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { RESET_CATEGORIES, computeWeeklyTrend } from '@/lib/compensation/cumulativeBonus'
import { computeKpis, computeScorecardRows, computePendingDues } from '@/lib/compensation/aggregates'

export const revalidate = 60

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

    // MANAGER scopes most queries to EMPLOYEE-handled rows only. Pre-fetch
    // the employee id list once and pass it down to every helper that
    // needs it — avoids 3 lookups of the same list across endpoints.
    let scopedUserIds: string[] | null = null
    if (session.role === UserRole.MANAGER) {
      const empUsers = await db.user.findMany({
        where: { isActive: true, role: 'EMPLOYEE' },
        select: { id: true },
      })
      scopedUserIds = empUsers.map((u: { id: string }) => u.id)
    }

    const [kpis, previous, scorecard, buckets, pending] = await Promise.all([
      computeKpis(from, to, scopedUserIds),
      compare
        ? (async () => {
            const lengthMs = to.getTime() - from.getTime()
            const prevTo = new Date(from.getTime() - 1)
            const prevFrom = new Date(prevTo.getTime() - lengthMs)
            prevFrom.setHours(0, 0, 0, 0)
            prevTo.setHours(23, 59, 59, 999)
            return computeKpis(prevFrom, prevTo, scopedUserIds)
          })()
        : Promise.resolve(null),
      computeScorecardRows({ from, to, role: session.role }),
      computeWeeklyTrend(from, to, scopedUserIds, RESET_CATEGORIES as unknown as string[]),
      computePendingDues(from, to, scopedUserIds),
    ])

    return NextResponse.json({
      success: true,
      period: { from: from.toISOString(), to: to.toISOString() },
      kpis,
      previous,
      data: scorecard,
      buckets,
      pendingDues: pending,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
