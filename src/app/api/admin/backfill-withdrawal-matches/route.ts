import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole, TransactionStatus, TransactionSource, TransactionType } from '@/lib/db/prisma-types'
import { extractShamCashTxId } from '@/lib/parsers/platformDeposits'
import { applyHistoricalWithdrawalPlatformOnlyMatches } from '@/lib/reconciliation/batchProcessor.historical'
import { isOpsBearer } from '@/lib/auth/opsToken'

// POST /api/admin/backfill-withdrawal-matches
//
// One-shot rescue for withdrawal rows stranded as PENDING_SC / PENDING_P by
// prior split-batch uploads (SC file uploaded separately from Platform file).
//
// Two phases, both idempotent:
//   A) Backfill `shamCashTxId` column on old PENDING_P WITHDRAWAL rows whose
//      inserts predated the persistence fix — the value is re-read from the
//      stored rawData (rawData.shamCashTxId or, as a fallback, re-extracted
//      from rawData.userInfo via the same regex the parser uses).
//   B) Per account, link every remaining PENDING_SC ↔ PENDING_P withdrawal
//      pair sharing a shamCashTxId, delegating to the shared helper.
//
// Long-lived by design: on a database with thousands of orphan rows the
// updates can take a while. Runs behind ADMIN auth. Neon-safe: updates in
// chunks of 500 so no single query holds a long row-lock window.
export const maxDuration = 300

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readScTxIdFromRawData(rawData: any): string | null {
  if (!rawData || typeof rawData !== 'object') return null
  // Preferred: parser already stored the extracted value on the row.
  if (typeof rawData.shamCashTxId === 'string' && rawData.shamCashTxId.trim()) {
    return rawData.shamCashTxId.trim()
  }
  // Fallback: re-extract from the original "User info" text — covers rawData
  // shapes that predate the parser field.
  const userInfo =
    (typeof rawData.userInfo === 'string' && rawData.userInfo) ||
    (typeof rawData['User info'] === 'string' && rawData['User info']) ||
    null
  return userInfo ? extractShamCashTxId(userInfo) : null
}

export async function POST(req: NextRequest) {
  try {
    // Auth: EITHER an ADMIN session cookie (normal admin UI path) OR an
    // operator/cron Bearer token. See lib/auth/opsToken.
    let auditUserId: string
    if (isOpsBearer(req)) {
      // AuditLog.userId is a real FK — attribute machine calls to the oldest
      // active ADMIN rather than a synthetic id that would violate it.
      const admin = await db.user.findFirst({
        where: { role: UserRole.ADMIN, isActive: true },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      })
      if (!admin) return NextResponse.json({ error: 'no admin user to attribute action' }, { status: 500 })
      auditUserId = admin.id
    } else {
      const session = await getSession()
      if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
      requireRole(session, [UserRole.ADMIN])
      auditUserId = session.userId
    }

    const startedAt = new Date()

    // ── Phase A: backfill shamCashTxId on PENDING_P withdrawal rows ──
    // Pull only the fields we need. Chunked read to avoid pulling 100k rows
    // at once — process, then continue with the next chunk.
    let extractedFromRaw = 0
    let couldNotExtract = 0
    let cursor: string | null = null
    const READ_CHUNK = 500
    for (;;) {
      const batch: Array<{ id: string; rawData: unknown }> = await db.transaction.findMany({
        where: {
          type: TransactionType.WITHDRAWAL,
          source: TransactionSource.PLATFORM,
          status: TransactionStatus.PENDING_P,
          shamCashTxId: null,
          rawData: { not: undefined },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, rawData: true },
        orderBy: { id: 'asc' },
        take: READ_CHUNK,
      })
      if (batch.length === 0) break

      for (const row of batch) {
        const scId = readScTxIdFromRawData(row.rawData)
        if (!scId) { couldNotExtract++; continue }
        try {
          await db.transaction.update({
            where: { id: row.id },
            data: { shamCashTxId: scId },
          })
          extractedFromRaw++
        } catch {
          // Silent — most likely a race with another mutation on the same row.
        }
      }
      cursor = batch[batch.length - 1].id
      if (batch.length < READ_CHUNK) break
    }

    // ── Phase B: per-account, link every PENDING_SC ↔ PENDING_P withdrawal
    // pair sharing a shamCashTxId. Reuses the same helper the upload flow
    // now calls per batch, so the linking logic stays single-sourced.
    const accounts = await db.account.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    const perAccount: Array<{ accountId: string; name: string; linked: number }> = []
    let totalLinked = 0
    for (const a of accounts) {
      // Collect ALL SC withdrawal txIds in this account that could still pair.
      // We pass the full set — the helper filters to matchedTxId=null on both
      // sides internally, so an already-matched pair is a no-op.
      const scRows: Array<{ shamCashTxId: string | null }> = await db.transaction.findMany({
        where: {
          accountId: a.id,
          source: TransactionSource.SHAM_CASH,
          type: TransactionType.WITHDRAWAL,
          status: TransactionStatus.PENDING_SC,
          shamCashTxId: { not: null },
          matchedTxId: null,
        },
        select: { shamCashTxId: true },
      })
      const scTxIds: string[] = Array.from(
        new Set(scRows.map(r => r.shamCashTxId).filter((s): s is string => !!s)),
      )
      if (scTxIds.length === 0) {
        perAccount.push({ accountId: a.id, name: a.name, linked: 0 })
        continue
      }
      const res = await applyHistoricalWithdrawalPlatformOnlyMatches(a.id, scTxIds)
      perAccount.push({ accountId: a.id, name: a.name, linked: res.updated })
      totalLinked += res.updated
    }

    const durationMs = Date.now() - startedAt.getTime()

    await audit(auditUserId, 'BACKFILL_WITHDRAWAL_MATCHES', 'Transaction', null as unknown as string, {
      extractedFromRaw,
      couldNotExtract,
      totalLinked,
      accountsScanned: accounts.length,
      durationMs,
    })

    return NextResponse.json({
      success: true,
      extractedFromRaw,
      couldNotExtract,
      totalLinked,
      perAccount: perAccount.filter(p => p.linked > 0),
      accountsScanned: accounts.length,
      durationMs,
    })
  } catch (e) {
    if (e instanceof Error && e.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 })
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
