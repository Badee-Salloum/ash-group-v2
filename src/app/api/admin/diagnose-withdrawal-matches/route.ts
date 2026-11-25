import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole, TransactionStatus, TransactionSource, TransactionType } from '@/lib/db/prisma-types'
import { isOpsBearer } from '@/lib/auth/opsToken'
import { damascusDayStartUtc, damascusDateStr, addDays } from '@/lib/datetime'

// Diagnostic-only companion to /api/admin/backfill-withdrawal-matches. Never
// mutates. Reports why an account's PENDING_SC withdrawals aren't linking to
// their expected PENDING_P counterparts — is the Platform side missing
// entirely, or does it exist but with a mismatched shamCashTxId, or extracted
// null? Auth: ADMIN session OR Bearer CRON_SECRET.
//
// GET /api/admin/diagnose-withdrawal-matches?accountName=Krokant-usd
//     &from=2026-08-29&to=2026-08-31   (optional, inclusive Damascus days)
//
// When from/to are supplied the SC-pending scan is limited to that window and
// the response carries a perDay breakdown — useful for "are these three
// specific days still stuck?" questions.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    if (!isOpsBearer(req)) {
      const session = await getSession()
      if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
      requireRole(session, [UserRole.ADMIN])
    }

    const nameFilter = req.nextUrl.searchParams.get('accountName') || undefined
    const from = req.nextUrl.searchParams.get('from') || undefined
    const to = req.nextUrl.searchParams.get('to') || undefined
    // Damascus calendar days → UTC instants. Half-open [start, nextDayStart).
    const dateWindow = from && to
      ? { gte: damascusDayStartUtc(from), lt: damascusDayStartUtc(addDays(to, 1)) }
      : undefined

    const accounts = await db.account.findMany({
      where: nameFilter ? { name: { contains: nameFilter, mode: 'insensitive' } } : {},
      select: { id: true, name: true },
    })
    if (accounts.length === 0) {
      return NextResponse.json({ ok: true, error: 'no accounts matched', nameFilter })
    }

    const perAccount = await Promise.all(accounts.map(async (a: { id: string; name: string }) => {
      const [scPending, platPendingAll, platPendingWithScId, matched, platDepositsAllWithScId] = await Promise.all([
        db.transaction.findMany({
          where: {
            accountId: a.id, source: TransactionSource.SHAM_CASH,
            type: TransactionType.WITHDRAWAL, status: TransactionStatus.PENDING_SC,
            ...(dateWindow ? { txDateTime: dateWindow } : {}),
          },
          select: {
            id: true, shamCashTxId: true, amount: true, txDateTime: true,
            matchedTxId: true, reviewCategory: true,
          },
        }),
        db.transaction.count({
          where: {
            accountId: a.id, source: TransactionSource.PLATFORM,
            type: TransactionType.WITHDRAWAL, status: TransactionStatus.PENDING_P,
          },
        }),
        db.transaction.findMany({
          where: {
            accountId: a.id, source: TransactionSource.PLATFORM,
            type: TransactionType.WITHDRAWAL, status: TransactionStatus.PENDING_P,
            shamCashTxId: { not: null },
          },
          select: { id: true, shamCashTxId: true, amount: true, txDateTime: true },
        }),
        db.transaction.count({
          where: {
            accountId: a.id, type: TransactionType.WITHDRAWAL,
            status: TransactionStatus.MATCHED,
          },
        }),
        // Cross-match universe: Platform DEPOSITS that carry a shamCashTxId
        // referring to an SC withdrawal (BankTranferComment). auto flow only
        // cross-matches within a single batch — historical PENDING_P/MATCHED
        // deposits pointing to SC withdrawal txIds live here.
        db.transaction.findMany({
          where: {
            accountId: a.id, source: TransactionSource.PLATFORM,
            type: TransactionType.DEPOSIT,
            shamCashTxId: { not: null },
          },
          select: { id: true, shamCashTxId: true, amount: true, status: true, matchedTxId: true },
        }),
      ])

      type ScRow = {
        id: string; shamCashTxId: string | null; amount: unknown; txDateTime: Date
        matchedTxId: string | null; reviewCategory: string | null
      }
      type PlatRow = { id: string; shamCashTxId: string | null; amount: unknown; txDateTime: Date }
      type DepRow = { id: string; shamCashTxId: string | null; amount: unknown; status: string; matchedTxId: string | null }
      const scIds = new Set((scPending as ScRow[]).map(r => r.shamCashTxId).filter(Boolean))
      const platIds = new Set((platPendingWithScId as PlatRow[]).map(r => r.shamCashTxId).filter(Boolean))
      const intersection = Array.from(scIds).filter(id => platIds.has(id!))

      // Cross-match universe: how many Platform DEPOSITS in this account
      // carry a shamCashTxId that matches one of our SC PENDING withdrawals.
      // If this number is non-zero, those SC withdrawals should have been
      // cross-matched to platform deposits — but the auto flow only does
      // that within a single batch.
      const depIds = new Set((platDepositsAllWithScId as DepRow[]).map(r => r.shamCashTxId).filter(Boolean))
      const crossMatchable = (platDepositsAllWithScId as DepRow[]).filter(d =>
        d.shamCashTxId && scIds.has(d.shamCashTxId),
      )
      const crossMatchableUnlinked = crossMatchable.filter(d => !d.matchedTxId)

      // For any SC PENDING row, does it have a matching Platform PENDING?
      // Sample wider when a date window narrowed the set.
      const sampleSize = dateWindow ? 50 : 20
      const scDetail = (scPending as ScRow[]).slice(0, sampleSize).map(r => ({
        id: r.id,
        shamCashTxId: r.shamCashTxId,
        amount: Number(r.amount),
        txDateTime: r.txDateTime,
        reviewCategory: r.reviewCategory,
        hasPlatformCounterpart: r.shamCashTxId ? platIds.has(r.shamCashTxId) : false,
        hasPlatformDepositCounterpart: r.shamCashTxId ? depIds.has(r.shamCashTxId) : false,
      }))

      // Per Damascus-day rollup. `unclassified` is the actionable number: rows
      // with no platform counterpart of any kind AND no reviewCategory yet —
      // exactly what bulk-classify would target.
      const dayMap = new Map<string, {
        day: string; count: number; withPlatformCounterpart: number
        stillOrphan: number; unclassified: number
      }>()
      for (const r of scPending as ScRow[]) {
        const day = damascusDateStr(r.txDateTime)
        let e = dayMap.get(day)
        if (!e) {
          e = { day, count: 0, withPlatformCounterpart: 0, stillOrphan: 0, unclassified: 0 }
          dayMap.set(day, e)
        }
        e.count++
        const linked = !!r.shamCashTxId && (platIds.has(r.shamCashTxId) || depIds.has(r.shamCashTxId))
        if (linked) e.withPlatformCounterpart++
        else {
          e.stillOrphan++
          if (!r.reviewCategory) e.unclassified++
        }
      }
      const perDay = Array.from(dayMap.values()).sort((x, y) => x.day.localeCompare(y.day))

      return {
        accountId: a.id,
        name: a.name,
        dateWindow: dateWindow ? { from, to } : null,
        perDay,
        counts: {
          scPending: scPending.length,
          platPendingTotal: platPendingAll,
          platPendingWithScId: platPendingWithScId.length,
          platPendingWithoutScId: platPendingAll - platPendingWithScId.length,
          matchedWithdrawals: matched,
          platDepositsWithScId: platDepositsAllWithScId.length,
        },
        overlap: {
          scIdsCount: scIds.size,
          platIdsCount: platIds.size,
          intersectionCount: intersection.length,
          firstIntersection: intersection.slice(0, 5),
        },
        crossMatch: {
          platDepositsPointingAtScWithdrawal: crossMatchable.length,
          unlinkedCrossMatchable: crossMatchableUnlinked.length,
          sampleUnlinked: crossMatchableUnlinked.slice(0, 5).map(d => ({
            id: d.id, shamCashTxId: d.shamCashTxId, amount: Number(d.amount), status: d.status,
          })),
        },
        scPendingSample: scDetail,
      }
    }))

    return NextResponse.json({ ok: true, accountsScanned: accounts.length, perAccount })
  } catch (e) {
    if (e instanceof Error && e.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 })
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
