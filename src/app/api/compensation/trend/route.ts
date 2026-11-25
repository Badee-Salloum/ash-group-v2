import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { RESET_CATEGORIES, computeWeeklyTrend } from '@/lib/compensation/cumulativeBonus'

// GET /api/compensation/trend?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Splits the requested period into weekly buckets (Sunday-start) and counts,
// per bucket, the matched transactions and the employee-fault errors
// (EMPLOYEE_ERROR + THEFT). Used by the WeeklyTrendChart on /compensation.
//
// Implementation: a SINGLE DATE_TRUNC groupBy query (raw SQL) — replaces
// the old 2-counts-per-bucket × 13-bucket loop that cost 26 DB roundtrips.

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPERVISOR])

    const params = req.nextUrl.searchParams
    const fromParam = params.get('from')
    const toParam = params.get('to')
    const from = fromParam ? new Date(fromParam) : new Date(Date.now() - 30 * 86_400_000)
    const to = toParam ? new Date(toParam) : new Date()

    // MANAGER scope: only EMPLOYEE-handled rows in the trend.
    let scopedUserIds: string[] | null = null
    if (session.role === UserRole.MANAGER) {
      const empUsers = await db.user.findMany({
        where: { isActive: true, role: 'EMPLOYEE' },
        select: { id: true },
      })
      scopedUserIds = empUsers.map((u: { id: string }) => u.id)
    }

    const buckets = await computeWeeklyTrend(from, to, scopedUserIds, RESET_CATEGORIES as unknown as string[])
    return NextResponse.json({ success: true, buckets })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
