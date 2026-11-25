import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 100

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (session.role !== UserRole.ADMIN) return NextResponse.json({ error: 'المدير فقط' }, { status: 403 })

  const q = req.nextUrl.searchParams.get('q')?.trim() || ''
  const accountId = req.nextUrl.searchParams.get('accountId')?.trim() || ''
  const dateFrom = req.nextUrl.searchParams.get('dateFrom')
  const dateTo = req.nextUrl.searchParams.get('dateTo')
  const requestedPage = Number.parseInt(req.nextUrl.searchParams.get('page') || '1', 10)
  const requestedPageSize = Number.parseInt(req.nextUrl.searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10)
  const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1
  const pageSize = Number.isFinite(requestedPageSize)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, requestedPageSize))
    : DEFAULT_PAGE_SIZE

  const where: Record<string, unknown> = { action: 'CONSOLIDATE_PAIR' }
  const sortBy = req.nextUrl.searchParams.get('sortBy') || 'createdAt'
  const sortDir = req.nextUrl.searchParams.get('sortDir') || 'desc'
  const sortColumns: Record<string, string> = {
    createdAt: 'l."createdAt"', account: `l.details->>'accountLabel'`, accountName: `l.details->>'accountName'`,
    amount: `CASE WHEN l.details->>'amount' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (l.details->>'amount')::numeric END`,
    depositSC: `l.details->'deposit'->>'shamCashTxId'`, withdrawalSC: `l.details->'withdrawal'->>'shamCashTxId'`,
    depositAccNum: `l.details->'deposit'->>'accountNumber'`, withdrawalAccNum: `l.details->'withdrawal'->>'accountNumber'`,
    notes: `concat_ws(' ', l.details->'deposit'->>'notes', l.details->'withdrawal'->>'notes')`, user: 'u.name',
  }
  if (!Object.prototype.hasOwnProperty.call(sortColumns, sortBy) || !['asc', 'desc'].includes(sortDir)) return NextResponse.json({ error: 'ترتيب غير صالح' }, { status: 400 })
  if (dateFrom || dateTo) {
    const range: Record<string, Date> = {}
    if (dateFrom) range.gte = new Date(dateFrom)
    if (dateTo) range.lte = new Date(dateTo + 'T23:59:59')
    where.createdAt = range
  }
  // Filter the JSON account key in Postgres before pagination. The previous
  // handler loaded 5,000 audit documents and filtered them in Node.
  if (accountId) {
    where.details = { path: ['accountId'], equals: accountId }
  }

  // JSON-backed columns must be ordered in PostgreSQL before the bounded page.
  if (sortBy !== 'createdAt' || q) {
    const bindings: unknown[] = []
    const bind = (value: unknown) => { bindings.push(value); return `$${bindings.length}` }
    const predicates = [`l.action = 'CONSOLIDATE_PAIR'`]
    if (accountId) predicates.push(`l.details->>'accountId' = ${bind(accountId)}`)
    if (dateFrom) predicates.push(`l."createdAt" >= ${bind(new Date(dateFrom))}`)
    if (dateTo) predicates.push(`l."createdAt" <= ${bind(new Date(dateTo + 'T23:59:59'))}`)
    if (q) { const pattern = bind(`%${q}%`); predicates.push(`(l.details::text ILIKE ${pattern} OR u.name ILIKE ${pattern})`) }
    const from = `FROM audit_logs l LEFT JOIN users u ON u.id = l."userId" WHERE ${predicates.join(' AND ')}`
    const direction = sortDir === 'asc' ? 'ASC' : 'DESC'
    const [counts, ids] = await Promise.all([
      db.$queryRawUnsafe(`SELECT count(*)::int AS total ${from}`, ...bindings) as Promise<Array<{ total: number }>>,
      db.$queryRawUnsafe(`SELECT l.id ${from} ORDER BY ${sortColumns[sortBy]} ${direction} NULLS LAST, l.id ${direction} LIMIT $${bindings.length + 1} OFFSET $${bindings.length + 2}`, ...bindings, pageSize, (page - 1) * pageSize) as Promise<Array<{ id: string }>>,
    ])
    const logs = await db.auditLog.findMany({ where: { ...where, id: { in: ids.map(row => row.id) } }, include: { user: { select: { name: true, email: true } } } })
    const positions = new Map(ids.map((row, index) => [row.id, index]))
    ;(logs as Array<{ id: string }>).sort((a, b) => positions.get(a.id)! - positions.get(b.id)!)
    const total = Number(counts[0]?.total || 0)
    return NextResponse.json({ success: true, data: logs, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize), hasNext: page * pageSize < total } }, { headers: { 'Cache-Control': 'private, no-store' } })
  }
  const [total, logs] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: sortDir }, { id: sortDir }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { name: true, email: true } } },
    }),
  ])

  return NextResponse.json({
    success: true,
    data: logs,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasNext: page * pageSize < total,
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}

// DELETE: remove consolidation log entries.
// Body: { ids?: string[], all?: boolean }
//   - ids: delete specific entries by their audit log id
//   - all: true → delete ALL CONSOLIDATE_PAIR entries (use with care)
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (session.role !== UserRole.ADMIN) return NextResponse.json({ error: 'المدير فقط' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map((x: unknown) => String(x)) : []
  const all = body.all === true

  let where: Record<string, unknown>
  if (all) {
    where = { action: 'CONSOLIDATE_PAIR' }
  } else if (ids.length > 0) {
    where = { action: 'CONSOLIDATE_PAIR', id: { in: ids } }
  } else {
    return NextResponse.json({ error: 'يجب تحديد ids أو all=true' }, { status: 400 })
  }

  const result = await db.auditLog.deleteMany({ where })
  return NextResponse.json({ success: true, deleted: result.count })
}
