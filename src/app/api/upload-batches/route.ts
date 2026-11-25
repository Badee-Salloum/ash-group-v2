import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { parseUploadSort, uploadOrderBy, UploadSortError } from '@/lib/uploads/sort'

// Vercel: 10s default is too tight for the batch DELETE below on large batches
// (thousands of transactions + audit_logs cleanup on Neon). Raise to 60s.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, Math.min(1_000_000, Number.parseInt(searchParams.get('page') || '1') || 1))
    const pageSize = Math.max(1, Math.min(100, Number.parseInt(searchParams.get('pageSize') || '25') || 25))
    const sort = parseUploadSort(searchParams)
    const accountId = searchParams.get('accountId') || undefined

    let accountFilter: Record<string, unknown> = {}
    if (session.role === UserRole.ACCOUNT_MGR) {
      const access = await db.accountAccess.findMany({ where: { userId: session.userId } })
      const ids = access.map((a: { accountId: string }) => a.accountId)
      accountFilter = { accountId: { in: ids } }
    } else if (accountId) {
      accountFilter = { accountId }
    }

    const [batches, total] = await Promise.all([
      db.uploadBatch.findMany({
        where: accountFilter,
        include: {
          account: { select: { name: true } },
          uploader: { select: { name: true } },
        },
        orderBy: uploadOrderBy(sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.uploadBatch.count({ where: accountFilter }),
    ])

    // Single grouped aggregate to attach (txDateFrom, txDateTo, txCount) per
    // batch — gives the user the "what period does this batch cover" chip in
    // the list view without N+1 lookups.
    const batchIds = batches.map((b: { id: string }) => b.id)
    const origins = batchIds.length ? await db.auditLog.findMany({
      where: { OR: [
        { action: 'UPLOAD_BATCH', entityId: { in: batchIds } },
        { action: 'UPLOAD_ATTEMPT', OR: batchIds.map((id: string) => ({ details: { path: ['batchId'], equals: id } })) },
      ] },
      select: { action: true, entityId: true, details: true }, orderBy: { createdAt: 'desc' },
    }) : []
    const originByBatch = new Map<string, { actorType?: string; authMethod?: string }>()
    for (const origin of origins) {
      const key = origin.action === 'UPLOAD_ATTEMPT' ? origin.details?.batchId : origin.entityId
      const metadata = origin.action === 'UPLOAD_ATTEMPT' ? origin.details : origin.details?.audit
      if (key && metadata && !originByBatch.has(key)) originByBatch.set(key, metadata)
    }
    const ranges = batchIds.length > 0
      ? await db.transaction.groupBy({
          by: ['batchId'],
          where: { batchId: { in: batchIds } },
          _min: { txDateTime: true },
          _max: { txDateTime: true },
          _count: { _all: true },
        })
      : []
    type RangeRow = {
      batchId: string | null
      _min: { txDateTime: Date | null }
      _max: { txDateTime: Date | null }
      _count: { _all: number }
    }
    const rangeByBatch = new Map<string, RangeRow>()
    for (const r of ranges as RangeRow[]) {
      if (r.batchId) rangeByBatch.set(r.batchId, r)
    }

    return NextResponse.json({
      success: true,
      data: batches.map((b: any) => {
        const r = rangeByBatch.get(b.id)
        const origin = originByBatch.get(b.id)
        return {
          id: b.id,
          accountName: b.account?.name || '—',
          uploaderName: origin?.actorType === 'SERVICE' ? `تشغيل آلي (${origin.authMethod || 'SERVICE'})` : b.uploader?.name || '—',
          actorType: origin?.actorType || 'UNKNOWN',
          authMethod: origin?.authMethod || 'UNSPECIFIED',
          batchDate: b.batchDate?.toISOString(),
          status: b.status,
          rowsProcessed: b.rowsProcessed || 0,
          errorLog: b.errorLog,
          processedAt: b.processedAt?.toISOString(),
          createdAt: b.createdAt.toISOString(),
          txDateFrom: r?._min.txDateTime?.toISOString() || null,
          txDateTo: r?._max.txDateTime?.toISOString() || null,
          txCount: r?._count._all || 0,
        }
      }),
      meta: { total, page, totalPages: Math.ceil(total / pageSize) },
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof UploadSortError) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.SUPERVISOR])

    const { searchParams } = new URL(req.url)
    const batchId = searchParams.get('id')
    if (!batchId) return NextResponse.json({ error: 'معرف الدفعة مطلوب' }, { status: 400 })

    const batch = await db.uploadBatch.findUnique({ where: { id: batchId } })
    if (!batch) return NextResponse.json({ error: 'الدفعة غير موجودة' }, { status: 404 })

    // Count transactions that will be deleted (for reporting)
    const txCount = await db.transaction.count({ where: { batchId } })

    // Pre-attempt audit row. The chunk loop below is non-atomic, so a mid-loop
    // Neon failure would leave orphaned partial state with zero forensic trace
    // if we only audited on the fully-successful path. This row is written
    // BEFORE any destructive work so operators can always trace who initiated
    // what — with a matching DELETE_BATCH row appended on success, or standing
    // alone if the loop crashed.
    try {
      await audit(session.userId, 'DELETE_BATCH_ATTEMPT', 'UploadBatch', batchId, {
        accountId: batch.accountId,
        rowsProcessed: batch.rowsProcessed,
        txCount,
      })
    } catch (e) {
      console.error('Pre-delete audit failed (proceeding anyway):', e)
    }

    // Delete transactions FIRST in chunks. This is the correctness-critical
    // work — if this fails, we bail without touching anything else. Non-atomic
    // on purpose: a large batch would otherwise hold a single long row-lock
    // transaction on Neon and time out. On mid-loop crash the next retry
    // finishes the remaining chunks and then removes the batch row.
    const CHUNK = 500
    for (;;) {
      const removed = await db.$executeRawUnsafe(
        `DELETE FROM "transactions"
         WHERE id IN (
           SELECT id FROM "transactions" WHERE "batchId" = $1 LIMIT ${CHUNK}
         )`,
        batchId
      )
      if (typeof removed !== 'number' || removed === 0) break
    }
    await db.uploadBatch.delete({ where: { id: batchId } })

    // NOTE: audit_logs (CONSOLIDATE_PAIR entries referencing this batchId) are
    // NOT cleaned up here. The JSON-path DELETE is unindexed and blocks the
    // Vercel function past maxDuration, and Promise.race with setTimeout does
    // NOT cancel a pending Prisma query — it stays on the Node event loop
    // and holds the response until Vercel returns FUNCTION_INVOCATION_TIMEOUT
    // (HTML page → SyntaxError on the client). Cosmetic-only orphan rows are
    // reaped by the daily cron at /api/cron/cleanup instead.

    // Audit AFTER the batch is gone — must never fail the request. The
    // destructive work has already committed; if the audit write throws
    // (Neon connection drop, schema drift, whatever) surfacing that as a
    // 500 would tell the user "delete failed" for a delete that succeeded,
    // and their retry would hit 404. Log and swallow instead.
    try {
      await audit(session.userId, 'DELETE_BATCH', 'UploadBatch', batchId, {
        accountId: batch.accountId,
        rowsProcessed: batch.rowsProcessed,
        txsDeleted: txCount,
      })
    } catch (e) {
      console.error('Post-delete audit failed (delete already committed):', e)
    }

    return NextResponse.json({
      success: true,
      message: 'تم حذف الدفعة وجميع عملياتها',
      stats: { txsDeleted: txCount },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
