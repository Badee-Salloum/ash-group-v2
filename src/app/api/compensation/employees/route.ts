import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { UserRole } from '@/lib/db/prisma-types'
import { computeScorecardRows } from '@/lib/compensation/aggregates'

// GET /api/compensation/employees?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// One scorecard row per active employee. The heavy lifting lives in
// src/lib/compensation/aggregates.ts so /api/compensation/dashboard can
// reuse the same logic.

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
    from.setHours(0, 0, 0, 0)
    to.setHours(23, 59, 59, 999)

    const rows = await computeScorecardRows({ from, to, role: session.role })
    return NextResponse.json({
      success: true,
      period: { from: from.toISOString(), to: to.toISOString() },
      data: rows,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
