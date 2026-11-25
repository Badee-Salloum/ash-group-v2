import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { isOpsBearer } from '@/lib/auth/opsToken'

// Exhaustive lookup: find every DB row (any account, any type, any status)
// whose shamCashTxId is in the provided list. Answers the question "are the
// platform-side rows for these SC txIds anywhere in the DB, or truly missing?"
// Read-only. ADMIN session OR Bearer CRON_SECRET.
//
// GET /api/admin/find-sc-tx?ids=421390230,421339586,...
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    if (!isOpsBearer(req)) {
      const session = await getSession()
      if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
      requireRole(session, [UserRole.ADMIN])
    }

    const ids = (req.nextUrl.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean)
    if (ids.length === 0) return NextResponse.json({ error: 'ids param required (comma-separated)' }, { status: 400 })
    if (ids.length > 100) return NextResponse.json({ error: 'max 100 ids' }, { status: 400 })

    // Look up every Transaction row with shamCashTxId in the list, plus every
    // audit_logs row whose details.batchId / details refers to these.
    const [txRows, accounts] = await Promise.all([
      db.transaction.findMany({
        where: { shamCashTxId: { in: ids } },
        select: {
          id: true, accountId: true, source: true, type: true, status: true,
          shamCashTxId: true, platformTxId: true, platformUserId: true,
          amount: true, currency: true, txDateTime: true, batchId: true,
          matchedTxId: true, reviewCategory: true, notes: true,
        },
        orderBy: [{ shamCashTxId: 'asc' }, { source: 'asc' }],
      }),
      db.account.findMany({ select: { id: true, name: true } }),
    ])
    const accountName = new Map((accounts as Array<{id:string;name:string}>).map(a => [a.id, a.name]))

    type Row = typeof txRows[0]
    const byScTxId: Record<string, Row[]> = {}
    for (const r of txRows as Row[]) {
      const key = r.shamCashTxId!
      if (!byScTxId[key]) byScTxId[key] = []
      byScTxId[key].push(r)
    }

    const perScTxId = ids.map(id => ({
      shamCashTxId: id,
      foundCount: (byScTxId[id] || []).length,
      rows: (byScTxId[id] || []).map(r => ({
        id: r.id,
        accountId: r.accountId,
        accountName: accountName.get(r.accountId) || '?',
        source: r.source,
        type: r.type,
        status: r.status,
        amount: Number(r.amount),
        currency: r.currency,
        txDateTime: r.txDateTime,
        platformTxId: r.platformTxId,
        platformUserId: r.platformUserId,
        matchedTxId: r.matchedTxId,
        reviewCategory: r.reviewCategory,
        batchId: r.batchId,
      })),
    }))

    return NextResponse.json({
      ok: true,
      requested: ids.length,
      totalRowsFound: txRows.length,
      perScTxId,
    })
  } catch (e) {
    if (e instanceof Error && e.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 })
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
