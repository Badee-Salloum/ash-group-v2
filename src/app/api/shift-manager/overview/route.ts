import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { parseTransactionListQuery, transactionListOrderBy, decodeTransactionCursor, buildTransactionKeysetClause, encodeTransactionCursor, cursorValueForTransaction } from '@/lib/transactions/query'
import type { Prisma } from '@prisma/client'

// Feeds /shift-manager. Returns:
//   * active — currently open ShiftSessions (ACTIVE + PENDING_END), the
//     employees inside them, and the wallets they cover.
//   * unconfirmed — transactions handled by any of those employees during
//     the active window that the SM hasn't yet confirmed
//     (shiftConfirmedAt IS NULL).
//   * summary — a per-employee performance rollup (matched / errors /
//     delays / accuracy) for the same window.
export async function GET(_req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  requireRole(session, [UserRole.SHIFT_MANAGER, UserRole.ADMIN, UserRole.MANAGER])
  let query
  try {
    query = parseTransactionListQuery(new URL(_req.url).searchParams)
    if (!['txDateTime', 'handledByUser', 'account', 'shamCashTxId', 'platformTxId', 'amount', 'hasDelay'].includes(query.sortBy)) throw new Error()
  } catch { return NextResponse.json({ success: false, error: 'ترتيب غير صالح' }, { status: 400 }) }
  let cursorWhere = {}
  try { if (query.cursor) cursorWhere = buildTransactionKeysetClause(decodeTransactionCursor(query.cursor, query)) }
  catch { return NextResponse.json({ success: false, error: 'مؤشر غير صالح' }, { status: 400 }) }

  const active = await db.shiftSession.findMany({
    where: { status: { in: ['ACTIVE', 'PENDING_END'] } },
    select: {
      id: true,
      userId: true,
      status: true,
      startAt: true,
      shiftNumber: true,
      user: { select: { id: true, name: true, employeeCode: true, avatarUrl: true } },
      wallets: { select: { accountId: true } },
    },
    orderBy: { startAt: 'desc' },
  })

  type ActiveRow = {
    id: string; userId: string; status: string; startAt: Date; shiftNumber: string | null
    user: { id: string; name: string; employeeCode: string | null; avatarUrl: string | null }
    wallets: Array<{ accountId: string }>
  }
  const rows = active as ActiveRow[]
  const employeeIds = Array.from(new Set(rows.map(r => r.userId)))

  if (employeeIds.length === 0) {
    return NextResponse.json({ success: true, active: [], unconfirmed: [], summary: [] })
  }

  // Bound the window to the earliest active session start (or 24h ago,
  // whichever is later). Transactions before that aren't part of a
  // currently-open shift.
  const oldestStart = rows.reduce(
    (min, r) => (r.startAt < min ? r.startAt : min),
    new Date(),
  )
  const windowStart = new Date(Math.max(oldestStart.getTime(), Date.now() - 24 * 60 * 60 * 1000))

  const queueWhere: Prisma.TransactionWhereInput = {
    handledByUserId: { in: employeeIds }, shiftConfirmedAt: null, txDateTime: { gte: windowStart },
    ...(query.search ? { OR: [
      { shamCashTxId: { contains: query.search, mode: 'insensitive' } }, { platformTxId: { contains: query.search, mode: 'insensitive' } },
      { handledByUser: { name: { contains: query.search, mode: 'insensitive' } } }, { account: { name: { contains: query.search, mode: 'insensitive' } } },
    ] } : {}),
  }
  const [unconfirmedRows, aggregateRows, total] = await Promise.all([
    db.transaction.findMany({
      where: { AND: [queueWhere, cursorWhere] },
      select: {
        id: true, shamCashTxId: true, platformTxId: true, amount: true, currency: true,
        txDateTime: true, status: true, reviewCategory: true, hasDelay: true,
        handledByUserId: true,
        handledByUser: { select: { id: true, name: true } },
        account: { select: { name: true } },
      },
      orderBy: transactionListOrderBy(query),
      take: query.limit + 1,
    }),
    db.transaction.groupBy({
      by: ['handledByUserId', 'status', 'reviewCategory'],
      where: {
        handledByUserId: { in: employeeIds },
        txDateTime: { gte: windowStart },
      },
      _count: { _all: true },
    }),
    db.transaction.count({ where: queueWhere }),
  ])

  type AggRow = { handledByUserId: string | null; status: string; reviewCategory: string | null; _count: { _all: number } }
  const totals = new Map<string, { matched: number; errors: number; total: number }>()
  for (const r of aggregateRows as AggRow[]) {
    if (!r.handledByUserId) continue
    const t = totals.get(r.handledByUserId) ?? { matched: 0, errors: 0, total: 0 }
    t.total += r._count._all
    if (r.status === 'MATCHED') t.matched += r._count._all
    if (r.reviewCategory === 'EMPLOYEE_ERROR' || r.reviewCategory === 'THEFT') {
      t.errors += r._count._all
    }
    totals.set(r.handledByUserId, t)
  }
  const delayCounts = await db.transaction.groupBy({
    by: ['handledByUserId'],
    where: {
      handledByUserId: { in: employeeIds },
      hasDelay: true,
      txDateTime: { gte: windowStart },
    },
    _count: { _all: true },
  })
  const delayMap = new Map(
    (delayCounts as Array<{ handledByUserId: string | null; _count: { _all: number } }>)
      .filter(r => r.handledByUserId != null)
      .map(r => [r.handledByUserId!, r._count._all]),
  )

  const summary = rows.map(r => {
    const t = totals.get(r.userId) ?? { matched: 0, errors: 0, total: 0 }
    return {
      userId: r.userId,
      name: r.user.name,
      matched: t.matched,
      errors: t.errors,
      total: t.total,
      delays: delayMap.get(r.userId) ?? 0,
      accuracy: t.total > 0 ? Math.round(((t.total - t.errors) / t.total) * 1000) / 10 : 0,
    }
  })

  return NextResponse.json({
    success: true,
    active: rows.map(r => ({
      sessionId: r.id,
      userId: r.userId,
      userName: r.user.name,
      employeeCode: r.user.employeeCode,
      avatarUrl: r.user.avatarUrl,
      status: r.status,
      startAt: r.startAt,
      shiftNumber: r.shiftNumber,
      accountIds: r.wallets.map(w => w.accountId),
    })),
    unconfirmed: unconfirmedRows.slice(0, query.limit),
    pageInfo: { total, hasNext: unconfirmedRows.length > query.limit,
      nextCursor: unconfirmedRows.length > query.limit ? encodeTransactionCursor({ id: unconfirmedRows[query.limit - 1].id, value: cursorValueForTransaction(unconfirmedRows[query.limit - 1], query.sortBy), sortBy: query.sortBy, sortDir: query.sortDir }) : null },
    summary,
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
