import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { getBonusThresholds } from '@/lib/settings/global'

// Manager-facing errors dashboard aggregation. Groups per employee for the
// requested window and evaluates each against the three streak-breaker
// thresholds (error ratio, error amount by currency, delay count). Rows
// include a `bonusStatus` badge the UI colour-codes.
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

  const params = req.nextUrl.searchParams
  const fromParam = params.get('from')
  const toParam = params.get('to')
  const from = fromParam ? new Date(fromParam) : new Date(Date.now() - 7 * 86_400_000)
  const to = toParam ? new Date(toParam) : new Date()
  from.setHours(0, 0, 0, 0)
  to.setHours(23, 59, 59, 999)

  const thresholds = await getBonusThresholds()

  // This page is specifically an EMPLOYEE scorecard. Branch managers use the
  // same role-based scope as the employees and compensation pages: every
  // active EMPLOYEE account, even when the optional managerId hierarchy was
  // never assigned. ADMIN sees this same employee-only scorecard.
  const employeeWhere: Record<string, unknown> = { isActive: true, role: UserRole.EMPLOYEE }

  const employees = await db.user.findMany({
    where: employeeWhere,
    select: { id: true, name: true, employeeCode: true, avatarUrl: true, role: true },
    orderBy: { name: 'asc' },
  })
  type EmpRow = { id: string; name: string; employeeCode: string | null; avatarUrl: string | null; role: string }
  const empIds = (employees as EmpRow[]).map(e => e.id)
  if (empIds.length === 0) {
    return NextResponse.json({ success: true, rows: [], thresholds })
  }

  const [statusAgg, errorAmountAgg, delayAgg] = await Promise.all([
    db.transaction.groupBy({
      by: ['handledByUserId', 'status', 'reviewCategory'],
      where: { handledByUserId: { in: empIds }, txDateTime: { gte: from, lte: to } },
      _count: { _all: true },
    }),
    db.transaction.groupBy({
      by: ['handledByUserId', 'currency'],
      where: {
        handledByUserId: { in: empIds },
        txDateTime: { gte: from, lte: to },
        reviewCategory: { in: ['EMPLOYEE_ERROR', 'THEFT'] },
      },
      _sum: { amount: true },
    }),
    db.transaction.groupBy({
      by: ['handledByUserId'],
      where: { handledByUserId: { in: empIds }, hasDelay: true, txDateTime: { gte: from, lte: to } },
      _count: { _all: true },
    }),
  ])

  type StatusRow = { handledByUserId: string | null; status: string; reviewCategory: string | null; _count: { _all: number } }
  type ErrRow = { handledByUserId: string | null; currency: string; _sum: { amount: unknown } }
  type DelayRow = { handledByUserId: string | null; _count: { _all: number } }

  const totals = new Map<string, { total: number; errors: number }>()
  for (const r of statusAgg as StatusRow[]) {
    if (!r.handledByUserId) continue
    const t = totals.get(r.handledByUserId) ?? { total: 0, errors: 0 }
    t.total += r._count._all
    if (r.reviewCategory === 'EMPLOYEE_ERROR' || r.reviewCategory === 'THEFT') {
      t.errors += r._count._all
    }
    totals.set(r.handledByUserId, t)
  }
  const errAmountByUser = new Map<string, Record<string, number>>()
  for (const r of errorAmountAgg as ErrRow[]) {
    if (!r.handledByUserId) continue
    const m = errAmountByUser.get(r.handledByUserId) ?? {}
    m[r.currency] = (m[r.currency] ?? 0) + Number(r._sum.amount ?? 0)
    errAmountByUser.set(r.handledByUserId, m)
  }
  const delayByUser = new Map(
    (delayAgg as DelayRow[])
      .filter(r => r.handledByUserId != null)
      .map(r => [r.handledByUserId!, r._count._all]),
  )

  const rows = (employees as EmpRow[]).map(e => {
    const t = totals.get(e.id) ?? { total: 0, errors: 0 }
    const errAmounts = errAmountByUser.get(e.id) ?? {}
    const delays = delayByUser.get(e.id) ?? 0
    const ratio = t.total > 0 ? t.errors / t.total : 0

    const breaches: string[] = []
    if (ratio > thresholds.ratioLimit) breaches.push('نسبة الأخطاء')
    for (const [cur, amt] of Object.entries(errAmounts)) {
      const limit = thresholds.amountLimits[cur] ?? Infinity
      if (amt > limit) breaches.push(`قيمة ${cur}`)
    }
    if (delays > thresholds.delayLimit) breaches.push('التأخيرات')

    return {
      id: e.id,
      name: e.name,
      employeeCode: e.employeeCode,
      avatarUrl: e.avatarUrl,
      handled: t.total,
      errors: t.errors,
      ratio: Math.round(ratio * 10_000) / 100, // %
      errorAmounts: errAmounts,
      delays,
      bonusStatus: breaches.length === 0 ? 'ok' : 'blocked',
      breaches,
    }
  })

  return NextResponse.json({ success: true, rows, thresholds, from: from.toISOString(), to: to.toISOString() })
}
