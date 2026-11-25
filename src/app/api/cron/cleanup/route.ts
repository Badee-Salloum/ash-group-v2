import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'

// Storage cleanup cron — deletes rows that grow unbounded and are cheap to
// lose:
//   * AuditLog older than 90 days.
//   * Notification rows older than 60 days AND already read (readAt IS NOT
//     NULL). Unread ones stay so the user doesn't lose a missed alert.
//   * Read notifications older than 180 days regardless — a safety net so
//     never-visited accounts don't accumulate forever.
//   * Orphan CONSOLIDATE_PAIR audit_logs whose batchId no longer exists in
//     upload_batches. These pile up on every /upload-history batch delete
//     because the DELETE hot path skips this expensive unindexed JSON-path
//     query — this cron reaps them without a user-facing timeout.
//
// Long-lived by design: raise maxDuration so the unindexed audit_logs scan
// has room to run. This function is invoked by Vercel Cron, not a user.
//
// Auth: same shape as weekly-payroll — accepts a Vercel-cron Bearer token
// when CRON_SECRET is set, or any caller otherwise. Configured via
// vercel.json to run daily at 03:00 UTC.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const now = Date.now()
  const days = (n: number) => new Date(now - n * 86_400_000)

  const [auditsDeleted, readNotifsDeleted, staleNotifsDeleted] = await Promise.all([
    db.auditLog.deleteMany({
      where: { createdAt: { lt: days(90) } },
    }),
    db.notification.deleteMany({
      where: {
        readAt: { not: null },
        createdAt: { lt: days(60) },
      },
    }),
    db.notification.deleteMany({
      where: { createdAt: { lt: days(180) } },
    }),
  ])

  // Reap CONSOLIDATE_PAIR audit rows that reference a deleted batch. Raw SQL
  // because Prisma cannot express the JSON-path filter on `details->>'batchId'`
  // nor a NOT IN correlated subquery cleanly. Wrapped in try/catch so a slow
  // JSON scan on a large audit_logs table can't take down the rest of the
  // cron — orphans just stay for another day.
  let orphanConsolidationLogsDeleted = 0
  try {
    const removed = await db.$executeRawUnsafe(`
      DELETE FROM "audit_logs"
      WHERE action = 'CONSOLIDATE_PAIR'
        AND details->>'batchId' IS NOT NULL
        AND details->>'batchId' NOT IN (SELECT id FROM "upload_batches")
    `)
    orphanConsolidationLogsDeleted = typeof removed === 'number' ? removed : 0
  } catch (e) {
    console.error('Orphan CONSOLIDATE_PAIR cleanup failed:', e)
  }

  return NextResponse.json({
    success: true,
    deleted: {
      auditLogs: auditsDeleted.count,
      readNotifications: readNotifsDeleted.count,
      staleNotifications: staleNotifsDeleted.count,
      orphanConsolidationLogs: orphanConsolidationLogsDeleted,
    },
    at: new Date().toISOString(),
  })
}
