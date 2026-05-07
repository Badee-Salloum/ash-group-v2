import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = Math.min(100, parseInt(searchParams.get('pageSize') || '25'))
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
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.uploadBatch.count({ where: accountFilter }),
    ])

    return NextResponse.json({
      success: true,
      data: batches.map((b: any) => ({
        id: b.id,
        accountName: b.account?.name || '—',
        uploaderName: b.uploader?.name || '—',
        batchDate: b.batchDate?.toISOString(),
        status: b.status,
        rowsProcessed: b.rowsProcessed || 0,
        errorLog: b.errorLog,
        processedAt: b.processedAt?.toISOString(),
        createdAt: b.createdAt.toISOString(),
      })),
      meta: { total, page, totalPages: Math.ceil(total / pageSize) },
    })
  } catch (error) {
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

    // Remove the consolidation audit entries tied to this batch.
    // The consolidation process stores `batchId` in AuditLog.details, so we
    // match by JSON field `details->>'batchId' = :batchId`. This works even
    // though the referenced transactions were already deleted at consolidation
    // time (that's why matching by entityId failed previously).
    let consolidationLogsDeleted = 0
    try {
      // Primary: match by batchId stored in details (entries created after the fix).
      const primary = await db.$executeRawUnsafe(
        `DELETE FROM "audit_logs"
         WHERE action = 'CONSOLIDATE_PAIR'
           AND details->>'batchId' = $1`,
        batchId
      )
      consolidationLogsDeleted += typeof primary === 'number' ? primary : 0

      // Fallback for legacy entries without batchId: match by same account
      // within a 10-minute window around the batch's creation time. This
      // catches consolidations performed during this specific upload.
      const batchCreated = batch.createdAt
      const windowStart = new Date(batchCreated.getTime() - 60 * 1000)            // -1 min
      const windowEnd = new Date(batchCreated.getTime() + 10 * 60 * 1000)         // +10 min
      const fallback = await db.$executeRawUnsafe(
        `DELETE FROM "audit_logs"
         WHERE action = 'CONSOLIDATE_PAIR'
           AND (details->>'batchId' IS NULL OR details->>'batchId' = '')
           AND details->>'accountId' = $1
           AND "createdAt" >= $2
           AND "createdAt" <= $3`,
        batch.accountId,
        windowStart,
        windowEnd
      )
      consolidationLogsDeleted += typeof fallback === 'number' ? fallback : 0
    } catch (e) {
      console.error('Failed to delete consolidation audit logs:', e)
    }

    // Delete all transactions linked to this batch, then the batch itself
    await db.$transaction([
      db.transaction.deleteMany({ where: { batchId } }),
      db.uploadBatch.delete({ where: { id: batchId } }),
    ])

    await audit(session.userId, 'DELETE_BATCH', 'UploadBatch', batchId, {
      accountId: batch.accountId,
      rowsProcessed: batch.rowsProcessed,
      txsDeleted: txCount,
      consolidationLogsDeleted,
    })

    return NextResponse.json({
      success: true,
      message: 'تم حذف الدفعة وجميع عملياتها',
      stats: { txsDeleted: txCount, consolidationLogsDeleted },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
