import { db } from '@/lib/db/client'
import { TransactionStatus, TransactionSource } from '@/lib/db/prisma-types'
import { isInternalTransfer } from './walletMatch'

// Cancel-out consolidation for PENDING_SC:
// Find pairs of (same accountName, same currency, same amount) where one is DEPOSIT
// and the other is WITHDRAWAL — delete both. No new transaction is created.
//
// SAFETY RULE: If either side of a candidate pair has a high-confidence (≥95%)
// potential match with an existing PENDING_P (same account/type/currency, same
// amount within 24h), the pair is SKIPPED — it's likely not a cancel-out, just
// a pending platform match that will resolve later.
//
// Every cancelled pair is written to the audit log (action: CONSOLIDATE_PAIR)
// with full details of BOTH sides, so deleted operations can be reviewed later.
const CONFIDENCE_PROTECT_THRESHOLD = 95
// Consolidation keeps its time-based component for pairing PENDING operations.
// Per request, the matching window is limited to 1 hour.
const MATCH_WINDOW_HOURS = 1

function computeConfidence(
  srcAmount: number,
  srcTime: Date,
  candAmount: number,
  candTime: Date
): number {
  const timeDiffSeconds = Math.abs(srcTime.getTime() - candTime.getTime()) / 1000
  if (timeDiffSeconds > MATCH_WINDOW_HOURS * 3600) return 0
  const amountDiff = Math.abs(srcAmount - candAmount)
  let confidence = 100
  confidence -= Math.min(30, (timeDiffSeconds / (MATCH_WINDOW_HOURS * 3600)) * 30)
  const amountPctDiff = srcAmount > 0 ? (amountDiff / srcAmount) * 100 : 100
  confidence -= Math.min(50, amountPctDiff * 2)
  if (amountDiff < 0.01) confidence = Math.max(confidence, 95)
  return Math.max(0, Math.min(100, Math.round(confidence)))
}

export async function consolidatePendingSC(
  accountId: string,
  userId: string | null = null,
  batchId: string | null = null
): Promise<{
  consolidatedGroups: number
  removedTransactions: number
  zeroNetGroups: number
  protectedPairs: number
}> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { walletIdentifiers: true, name: true },
  })
  const walletIds = account?.walletIdentifiers || []

  const allPending = await db.transaction.findMany({
    where: { accountId, status: TransactionStatus.PENDING_SC, source: TransactionSource.SHAM_CASH, matchedTxId: null },
    select: { id: true, type: true, currency: true, amount: true, rawData: true, txDateTime: true, shamCashTxId: true },
  })

  // Exclude internal transfers from pairing logic
  const externalPending = allPending.filter((t: typeof allPending[0]) => {
    const raw = t.rawData as Record<string, unknown> | null
    if (!raw) return true
    return !isInternalTransfer(
      String(raw.accountNumber || ''),
      String(raw.accountName || ''),
      String(raw.notes || ''),
      walletIds
    )
  })

  // Load all PENDING_P for this account to check high-confidence potential matches
  const allPendingP = await db.transaction.findMany({
    where: { accountId, status: TransactionStatus.PENDING_P, matchedTxId: null },
    select: { id: true, type: true, currency: true, amount: true, txDateTime: true },
  })

  // Helper: has a ≥threshold% potential match in PENDING_P?
  const hasHighConfidenceMatch = (tx: typeof externalPending[0]): boolean => {
    const srcAmount = Number(tx.amount)
    for (const p of allPendingP) {
      if (p.type !== tx.type) continue
      if (p.currency !== tx.currency) continue
      const conf = computeConfidence(srcAmount, tx.txDateTime, Number(p.amount), p.txDateTime)
      if (conf >= CONFIDENCE_PROTECT_THRESHOLD) return true
    }
    return false
  }

  // Group by (accountName + currency + amount), split into deposits/withdrawals
  type Row = typeof externalPending[0]
  type Bucket = { deposits: Row[]; withdrawals: Row[] }
  const buckets = new Map<string, Bucket>()

  for (const t of externalPending) {
    const raw = t.rawData as Record<string, unknown> | null
    const accountName = String(raw?.accountName || '').trim() || 'بدون اسم'
    const amountKey = Number(t.amount || 0).toFixed(2)
    const key = `${accountName}||${t.currency}||${amountKey}`
    if (!buckets.has(key)) buckets.set(key, { deposits: [], withdrawals: [] })
    const b = buckets.get(key)!
    if (t.type === 'DEPOSIT') b.deposits.push(t)
    else b.withdrawals.push(t)
  }

  // Pair deposits↔withdrawals 1-to-1, skipping pairs where either side is "protected"
  // (has a high-confidence potential platform match).
  const pairs: Array<{ deposit: Row; withdrawal: Row }> = []
  let protectedCount = 0

  for (const b of buckets.values()) {
    const n = Math.min(b.deposits.length, b.withdrawals.length)
    for (let i = 0; i < n; i++) {
      const d = b.deposits[i]
      const w = b.withdrawals[i]
      if (hasHighConfidenceMatch(d) || hasHighConfidenceMatch(w)) {
        protectedCount++
        continue
      }
      pairs.push({ deposit: d, withdrawal: w })
    }
  }

  if (pairs.length === 0) {
    return {
      consolidatedGroups: 0,
      removedTransactions: 0,
      zeroNetGroups: 0,
      protectedPairs: protectedCount,
    }
  }

  // Write audit log BEFORE deleting so deleted data is preserved
  const auditRecords = pairs.map(({ deposit, withdrawal }) => {
    const depRaw = (deposit.rawData || {}) as Record<string, unknown>
    const wdRaw = (withdrawal.rawData || {}) as Record<string, unknown>
    const accountName = String(depRaw.accountName || wdRaw.accountName || 'بدون اسم')
    return {
      userId,
      action: 'CONSOLIDATE_PAIR',
      entity: 'Transaction',
      entityId: deposit.id,
      details: {
        accountId,
        batchId,
        accountLabel: account?.name || '',
        currency: deposit.currency,
        amount: Number(deposit.amount),
        accountName,
        deposit: {
          id: deposit.id,
          shamCashTxId: deposit.shamCashTxId,
          txDateTime: deposit.txDateTime,
          accountNumber: String(depRaw.accountNumber || ''),
          notes: String(depRaw.notes || ''),
        },
        withdrawal: {
          id: withdrawal.id,
          shamCashTxId: withdrawal.shamCashTxId,
          txDateTime: withdrawal.txDateTime,
          accountNumber: String(wdRaw.accountNumber || ''),
          notes: String(wdRaw.notes || ''),
        },
      } as Record<string, unknown>,
    }
  })

  const idsToDelete = pairs.flatMap(p => [p.deposit.id, p.withdrawal.id])

  await db.auditLog.createMany({ data: auditRecords as any })
  await db.transaction.deleteMany({ where: { id: { in: idsToDelete } } })

  return {
    consolidatedGroups: pairs.length,
    removedTransactions: idsToDelete.length,
    zeroNetGroups: pairs.length,
    protectedPairs: protectedCount,
  }
}
