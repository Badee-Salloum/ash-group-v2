import { db } from '@/lib/db/client'
import { createId } from '@paralleldrive/cuid2'
import { resolveHistoricalComplaints } from '@/lib/reconciliation/deposits'
import { TransactionStatus, TransactionSource, TransactionType } from '@/lib/db/prisma-types'
import type { HistoricalScIdMatch } from './batchProcessor.deposits'
import { upsertCustomerNamesFromBatch } from './customerNames'

// ── Historical platform-only matches: link old PENDING_P platform rows to
// freshly-uploaded SC rows. This is the reverse of applyHistoricalScIdMatches:
//   - Old DB has Platform row with status=PENDING_P and shamCashTxId=X
//   - New batch brings SC row with txId=X
//   - They should be MATCHED, not the platform sitting orphan as PENDING_P
//
// Updates the old platform row in place (preserves its id / batchId) instead
// of relying on dedupe to delete + reinsert (which can be tripped up by FK
// edges and pair-dropping logic).
export async function applyHistoricalPlatformOnlyMatches(
  accountId: string,
  scTxIds: string[],
): Promise<{ updated: number }> {
  if (scTxIds.length === 0) return { updated: 0 }

  // Find fresh SC rows in this account that just got persisted MATCHED-or-PENDING
  const newScRows = await db.transaction.findMany({
    where: {
      accountId,
      source: TransactionSource.SHAM_CASH,
      shamCashTxId: { in: scTxIds },
    },
    select: { id: true, shamCashTxId: true, status: true, amount: true, currency: true },
  })
  const scByTxId = new Map<string, typeof newScRows[0]>()
  for (const r of newScRows) {
    if (r.shamCashTxId) scByTxId.set(r.shamCashTxId, r)
  }

  // Find old PENDING_P platform rows whose shamCashTxId matches one of these.
  // Pull rawData + platformUserId so we can backfill the customer name table
  // when the link succeeds.
  const stalePlatform = await db.transaction.findMany({
    where: {
      accountId,
      source: TransactionSource.PLATFORM,
      status: TransactionStatus.PENDING_P,
      shamCashTxId: { in: scTxIds },
      matchedTxId: null,
    },
    select: { id: true, shamCashTxId: true, amount: true, currency: true, platformUserId: true, rawData: true },
  })

  let updated = 0
  // Records to feed the customer-name upserter once linking is done.
  const linkedSCRecords: Array<{
    source: string; status: string; platformUserId?: string | null; rawData?: unknown
  }> = []
  for (const plat of stalePlatform) {
    if (!plat.shamCashTxId) continue
    const sc = scByTxId.get(plat.shamCashTxId)
    if (!sc) continue
    const scAmt = Number(sc.amount || 0)
    const plAmt = Number(plat.amount || 0)
    const isExact = Math.abs(scAmt - plAmt) <= 0.001
    const newStatus = isExact ? TransactionStatus.MATCHED : TransactionStatus.DISCREPANCY

    await db.$transaction([
      db.transaction.update({
        where: { id: plat.id },
        data: {
          status: newStatus,
          matchedTxId: sc.id,
          ...(isExact ? {} : { amountDiff: Math.abs(scAmt - plAmt) }),
        },
      }),
      // Also propagate platformUserId from the old platform row onto the SC
      // row — without this the SC row stays user-id-less, and the customer
      // resolver can't find it by USER ID.
      db.transaction.update({
        where: { id: sc.id },
        data: {
          status: newStatus,
          matchedTxId: plat.id,
          platformUserId: plat.platformUserId,
          ...(isExact ? {} : { amountDiff: Math.abs(scAmt - plAmt) }),
        },
      }),
    ])
    // Pull the freshly-linked SC row's rawData (we need accountName).
    const scFull = await db.transaction.findUnique({
      where: { id: sc.id },
      select: { rawData: true },
    })
    linkedSCRecords.push({
      source: 'SHAM_CASH',
      status: newStatus,
      platformUserId: plat.platformUserId,
      rawData: scFull?.rawData,
    })
    updated++
  }

  // Backfill customer names for the just-linked pairs (defensive — silent if
  // customers table is missing).
  if (linkedSCRecords.length > 0) {
    await upsertCustomerNamesFromBatch(linkedSCRecords)
  }
  return { updated }
}

type ResolvedComplaint = ReturnType<typeof resolveHistoricalComplaints>[number]

// ── Resolve historical complaints (updates existing records) ──
// If a platform row with the same platformTxId already exists, reuse it
// instead of creating a duplicate.
export async function applyResolvedComplaints(
  accountId: string,
  batchId: string,
  resolved: ResolvedComplaint[],
): Promise<void> {
  for (const r of resolved) {
    const existingPlatform = await db.transaction.findFirst({
      where: {
        accountId,
        source: TransactionSource.PLATFORM,
        platformTxId: r.platformRow.txId,
      },
    })

    let platformId: string
    if (existingPlatform) {
      platformId = existingPlatform.id
      await db.transaction.update({
        where: { id: existingPlatform.id },
        data: {
          status: TransactionStatus.MATCHED,
          matchedTxId: r.pendingTxId,
        },
      })
    } else {
      platformId = createId()
      await db.transaction.create({
        data: {
          id: platformId,
          accountId, batchId, source: TransactionSource.PLATFORM, type: TransactionType.DEPOSIT,
          platformTxId: r.platformRow.txId, platformUserId: r.platformRow.userId,
          amount: r.platformRow.amount, currency: r.platformRow.currency, txDateTime: r.platformRow.createdAt,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          status: TransactionStatus.MATCHED, rawData: r.platformRow as any,
        },
      })
      await db.transaction.update({
        where: { id: platformId },
        data: { matchedTxId: r.pendingTxId },
      })
    }

    await db.transaction.update({
      where: { id: r.pendingTxId },
      data: {
        status: TransactionStatus.MATCHED,
        platformTxId: r.platformRow.txId,
        platformUserId: r.platformRow.userId,
        matchedTxId: platformId,
      },
    })
  }
}

export interface HistoricalScIdResult {
  resolved: number
  discrepancy: number
}

// ── Historical SC-ID matches: update old PENDING_SC and create new platform rows ──
export async function applyHistoricalScIdMatches(
  accountId: string,
  batchId: string,
  historicalMatchesByScTxId: HistoricalScIdMatch[],
): Promise<HistoricalScIdResult> {
  let resolved = 0
  let discrepancy = 0

  for (const match of historicalMatchesByScTxId) {
    const pendingRow = await db.transaction.findUnique({
      where: { id: match.pendingTxId },
    })
    if (!pendingRow) continue

    if (match.matchType === 'MATCHED') {
      // If a platform row with the same platformTxId already exists (from a
      // prior upload that came before the SC-ID link was established), reuse
      // it instead of creating a new one — prevents duplicate rows.
      const existingPlatform = await db.transaction.findFirst({
        where: {
          accountId,
          source: TransactionSource.PLATFORM,
          platformTxId: match.platformRow.txId,
        },
      })

      let platformId: string
      if (existingPlatform) {
        platformId = existingPlatform.id
        await db.transaction.update({
          where: { id: existingPlatform.id },
          data: {
            status: TransactionStatus.MATCHED,
            matchedTxId: match.pendingTxId,
            shamCashTxId: match.platformRow.shamCashTxId,
            platformUserId: match.platformRow.userId,
            notes: existingPlatform.notes
              ? `${existingPlatform.notes} | [ربط تاريخي برقم شام كاش]`
              : '[ربط تاريخي برقم شام كاش]',
          },
        })
      } else {
        // Create new platform row (FK-safe: without matchedTxId yet)
        platformId = createId()
        await db.transaction.create({
          data: {
            id: platformId,
            accountId, batchId,
            source: TransactionSource.PLATFORM,
            type: TransactionType.DEPOSIT,
            platformTxId: match.platformRow.txId,
            platformUserId: match.platformRow.userId,
            shamCashTxId: match.platformRow.shamCashTxId,
            amount: match.platformRow.amount,
            currency: match.platformRow.currency,
            txDateTime: match.platformRow.createdAt,
            status: TransactionStatus.MATCHED,
            notes: '[ربط تاريخي برقم شام كاش]',
            rawData: match.platformRow as unknown as Record<string, unknown>,
          },
        })
        await db.transaction.update({
          where: { id: platformId },
          data: { matchedTxId: match.pendingTxId },
        })
      }

      // Link the SC-side pending row to the platform row
      await db.transaction.update({
        where: { id: match.pendingTxId },
        data: {
          status: TransactionStatus.MATCHED,
          platformTxId: match.platformRow.txId,
          platformUserId: match.platformRow.userId,
          matchedTxId: platformId,
          notes: '[ربط تاريخي برقم شام كاش]',
        },
      })
      resolved++
    } else {
      // Create discrepancy: update old pending, create new platform row
      const diffAmount = match.diff
      if (match.matchType === 'DISCREPANCY_SC_HIGHER') {
        // SC pending has more than platform — SC side becomes DISCREPANCY
        await db.transaction.update({
          where: { id: match.pendingTxId },
          data: {
            status: TransactionStatus.DISCREPANCY,
            platformTxId: match.platformRow.txId,
            platformUserId: match.platformRow.userId,
            amountDiff: diffAmount,
            notes: '[ربط تاريخي - فارق SC أكبر]',
          },
        })
      } else {
        // Platform row has more than SC pending — platform side DISCREPANCY
        // Mark old pending as matched but platform row created separately with discrepancy
        const updatedPending = await db.transaction.update({
          where: { id: match.pendingTxId },
          data: {
            status: TransactionStatus.DISCREPANCY,
            notes: '[ربط تاريخي - فارق المنصة أكبر]',
          },
        })
        await db.transaction.create({
          data: {
            accountId, batchId,
            source: TransactionSource.PLATFORM,
            type: TransactionType.DEPOSIT,
            platformTxId: match.platformRow.txId,
            platformUserId: match.platformRow.userId,
            shamCashTxId: match.platformRow.shamCashTxId,
            amount: match.platformRow.amount,
            currency: match.platformRow.currency,
            txDateTime: match.platformRow.createdAt,
            status: TransactionStatus.DISCREPANCY,
            amountDiff: diffAmount,
            matchedTxId: updatedPending.id,
            notes: '[ربط تاريخي - فارق المنصة أكبر]',
            rawData: { sc: { ...pendingRow }, platform: match.platformRow } as unknown as Record<string, unknown>,
          },
        })
      }
      discrepancy++
    }
  }

  return { resolved, discrepancy }
}
