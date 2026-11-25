import { db } from '@/lib/db/client'
import { TransactionStatus, TransactionSource } from '@/lib/db/prisma-types'

// Restore the post-unlink status for a row, derived from its source.
//   SHAM_CASH → PENDING_SC
//   PLATFORM  → PENDING_P
export function pendingStatusForSource(source: string): TransactionStatus {
  return source === TransactionSource.SHAM_CASH
    ? TransactionStatus.PENDING_SC
    : TransactionStatus.PENDING_P
}

type DbLike = typeof db

// Unlink a single pair: clear matchedTxId + amountDiff on both rows and
// restore each to its appropriate PENDING_* bucket. The caller must already
// have validated that `tx` is MATCHED or DISCREPANCY and has a `matchedTxId`.
//
// Use the optional `txClient` to run inside an existing `db.$transaction`
// callback; otherwise we open our own.
export async function unlinkPair(
  txId: string,
  txClient?: DbLike,
): Promise<{ unlinkedIds: string[] }> {
  const client = txClient ?? db
  const tx = await client.transaction.findUnique({
    where: { id: txId },
    select: { id: true, source: true, status: true, matchedTxId: true },
  })
  if (!tx || !tx.matchedTxId) return { unlinkedIds: [] }
  const partner = await client.transaction.findUnique({
    where: { id: tx.matchedTxId },
    select: { id: true, source: true },
  })
  const ops = [
    client.transaction.update({
      where: { id: tx.id },
      data: {
        status: pendingStatusForSource(tx.source),
        matchedTxId: null,
        amountDiff: null,
      },
    }),
    ...(partner
      ? [
          client.transaction.update({
            where: { id: partner.id },
            data: {
              status: pendingStatusForSource(partner.source),
              matchedTxId: null,
              amountDiff: null,
            },
          }),
        ]
      : []),
  ]
  if (txClient) {
    // We're already inside a transaction — await each op.
    for (const op of ops) await op
  } else {
    await db.$transaction(ops)
  }
  return { unlinkedIds: partner ? [tx.id, partner.id] : [tx.id] }
}

// Bulk variant for the "replace-file" flow. Given a set of row IDs that are
// about to be deleted, restore each of their partners to PENDING_* and clear
// the link. Returns the partner IDs that were touched (count and ids).
//
// The to-be-deleted rows themselves are NOT modified here — the caller is
// responsible for deleting them after this returns.
export async function unlinkPartnersOf(
  removedRowIds: string[],
  txClient: DbLike,
): Promise<{ unlinkedPartnerIds: string[] }> {
  if (removedRowIds.length === 0) return { unlinkedPartnerIds: [] }
  const removedRows = await txClient.transaction.findMany({
    where: { id: { in: removedRowIds } },
    select: { id: true, matchedTxId: true },
  })
  const partnerIds = removedRows
    .map((r: { matchedTxId: string | null }) => r.matchedTxId)
    .filter((id: string | null): id is string => Boolean(id))
  if (partnerIds.length === 0) return { unlinkedPartnerIds: [] }
  const partners = await txClient.transaction.findMany({
    where: { id: { in: partnerIds } },
    select: { id: true, source: true },
  })
  // Group by source to update in two batched calls.
  const scPartnerIds: string[] = []
  const plPartnerIds: string[] = []
  for (const p of partners as Array<{ id: string; source: string }>) {
    if (p.source === TransactionSource.SHAM_CASH) scPartnerIds.push(p.id)
    else plPartnerIds.push(p.id)
  }
  if (scPartnerIds.length > 0) {
    await txClient.transaction.updateMany({
      where: { id: { in: scPartnerIds } },
      data: { status: TransactionStatus.PENDING_SC, matchedTxId: null, amountDiff: null },
    })
  }
  if (plPartnerIds.length > 0) {
    await txClient.transaction.updateMany({
      where: { id: { in: plPartnerIds } },
      data: { status: TransactionStatus.PENDING_P, matchedTxId: null, amountDiff: null },
    })
  }
  return { unlinkedPartnerIds: partners.map((p: { id: string }) => p.id) }
}
