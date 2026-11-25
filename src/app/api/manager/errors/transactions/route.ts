import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

// Drill-down for /manager/errors: given an employee id + a date range,
// returns up to 200 error transactions the employee handled inside the
// window. Auth: ADMIN + MANAGER; MANAGER is scoped to active EMPLOYEE
// accounts, matching the parent dashboard's role-based scope.
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

  const params = req.nextUrl.searchParams
  const employeeId = params.get('employeeId')
  const fromParam = params.get('from')
  const toParam = params.get('to')
  const sortColumns: Record<string, string> = {
    txDateTime: 't."txDateTime"', account: 'a.name', shamCashTxId: 't."shamCashTxId"', platformTxId: 't."platformTxId"',
    amount: 't.amount', reviewCategory: 't."reviewCategory"',
    displayNotes: `COALESCE(NULLIF(trim(t."reviewNotes"), ''), NULLIF(trim(t.notes), ''))`, reviewerName: 'u.name',
  }
  const sortBy = params.get('sortBy') || 'txDateTime', sortDir = params.get('sortDir') || 'desc'
  if (!Object.prototype.hasOwnProperty.call(sortColumns, sortBy) || !['asc', 'desc'].includes(sortDir)) return NextResponse.json({ error: 'ترتيب غير صالح' }, { status: 400 })
  const page = Math.max(1, Math.trunc(Number(params.get('page')) || 1))
  const pageSize = 50
  if (!employeeId) return NextResponse.json({ error: 'employeeId مطلوب' }, { status: 400 })

  const from = fromParam ? new Date(fromParam) : new Date(Date.now() - 7 * 86_400_000)
  const to = toParam ? new Date(toParam) : new Date()
  from.setHours(0, 0, 0, 0)
  to.setHours(23, 59, 59, 999)

  // A branch manager may inspect any active EMPLOYEE account shown by the
  // parent dashboard. managerId is optional hierarchy metadata and must not
  // make otherwise valid employee accounts disappear from this page.
  if (session.role === UserRole.MANAGER) {
    const emp = await db.user.findUnique({
      where: { id: employeeId },
      select: { role: true, isActive: true },
    })
    if (!emp || !emp.isActive || emp.role !== UserRole.EMPLOYEE) {
      return NextResponse.json({ error: 'مدير الفرع يستطيع رؤية حسابات الموظفين الفعّالة فقط' }, { status: 403 })
    }
  }

  const where = {
      handledByUserId: employeeId,
      txDateTime: { gte: from, lte: to },
      reviewCategory: { in: ['EMPLOYEE_ERROR', 'THEFT'] as ('EMPLOYEE_ERROR' | 'THEFT')[] },
  }
  const direction = sortDir === 'asc' ? 'ASC' : 'DESC'
  const [ids, total] = await Promise.all([
    db.$queryRawUnsafe(`SELECT t.id FROM transactions t
      LEFT JOIN accounts a ON a.id = t."accountId" LEFT JOIN users u ON u.id = t."reviewedBy"
      WHERE t."handledByUserId" = $1 AND t."txDateTime" >= $2 AND t."txDateTime" <= $3
        AND t."reviewCategory" IN ('EMPLOYEE_ERROR', 'THEFT')
      ORDER BY ${sortColumns[sortBy]} ${direction} NULLS LAST, t.id ${direction} LIMIT $4 OFFSET $5`, employeeId, from, to, pageSize, (page - 1) * pageSize) as Promise<Array<{ id: string }>>,
    db.transaction.count({ where }),
  ])
  const rows = await db.transaction.findMany({
    where: { ...where, id: { in: ids.map(row => row.id) } },
    select: {
      id: true,
      txDateTime: true,
      shamCashTxId: true,
      platformTxId: true,
      amount: true,
      currency: true,
      reviewCategory: true,
      notes: true,
      reviewNotes: true,
      reviewedAt: true,
      account: { select: { name: true } },
      // The Prisma `reviewedBy` is a scalar (User.id), not a relation, so
      // we look up the name in a second pass to keep the query cheap.
      reviewedBy: true,
    },
  })
  const positions = new Map(ids.map((row, index) => [row.id, index]))
  ;(rows as Array<{ id: string }>).sort((a, b) => positions.get(a.id)! - positions.get(b.id)!)

  // Cheap resolver for reviewer names.
  const reviewerIds = Array.from(
    new Set(
      (rows as Array<{ reviewedBy: string | null }>)
        .map(r => r.reviewedBy)
        .filter((v): v is string => Boolean(v)),
    ),
  )
  const reviewers = reviewerIds.length > 0
    ? await db.user.findMany({
        where: { id: { in: reviewerIds } },
        select: { id: true, name: true },
      })
    : []
  const reviewerMap = new Map((reviewers as Array<{ id: string; name: string }>).map(u => [u.id, u.name]))

  const data = (rows as Array<Record<string, unknown>>).map(r => {
    const reviewNotes = typeof r.reviewNotes === 'string' ? r.reviewNotes.trim() : ''
    const transactionNotes = typeof r.notes === 'string' ? r.notes.trim() : ''
    return {
      ...r,
      // The reconciliation page labels the transaction's general `notes` as
      // "ملاحظات". Error review notes are more specific, so prefer them when
      // present and otherwise show the same transaction note here.
      displayNotes: reviewNotes || transactionNotes || null,
      reviewerName: r.reviewedBy ? reviewerMap.get(r.reviewedBy as string) ?? null : null,
    }
  })

  return NextResponse.json({ success: true, rows: data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } }, { headers: { 'Cache-Control': 'private, no-store' } })
}
