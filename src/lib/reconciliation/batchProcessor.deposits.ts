import { db } from '@/lib/db/client'
import { createId } from '@paralleldrive/cuid2'
import { reconcileDeposits } from '@/lib/reconciliation/deposits'
import { TransactionStatus, TransactionSource, TransactionType } from '@/lib/db/prisma-types'

type ScRows = Parameters<typeof reconcileDeposits>[0]
type DepRows = Parameters<typeof reconcileDeposits>[1]
type DepReconciliation = ReturnType<typeof reconcileDeposits>

export interface HistoricalScIdMatch {
  pendingTxId: string
  pendingAmount: number
  platformRow: DepReconciliation['platformOnly'][number]
  matchType: 'MATCHED' | 'DISCREPANCY_SC_HIGHER' | 'DISCREPANCY_P_HIGHER'
  diff: number
}

export interface DepositStepResult {
  depReconciliation: DepReconciliation
  records: Array<Record<string, unknown>>
  matchedPairs: Array<[string, string]>
  usedDepositPlatformIds: Set<string>
  matchedSCByDeposits: Set<string>
  historicalMatchesByScTxId: HistoricalScIdMatch[]
}

export async function runDepositStep(
  accountId: string,
  batchId: string,
  scRows: ScRows,
  depRows: DepRows,
  walletIdentifiers: string[],
): Promise<DepositStepResult> {
  // 4. Run deposit reconciliation (استقبال vs epaylist — by TX ID)
  const depReconciliation = reconcileDeposits(scRows, depRows, walletIdentifiers)

  // Track which deposit platform rows were already used
  const usedDepositPlatformIds = new Set<string>()
  for (const pair of depReconciliation.matched) usedDepositPlatformIds.add(pair.platform.txId)
  for (const d of depReconciliation.discrepancySCHigher) usedDepositPlatformIds.add(d.platform.txId)
  for (const d of depReconciliation.discrepancyPHigher) usedDepositPlatformIds.add(d.platform.txId)

  // 4.5. Match historical PENDING_SC deposits against new platform rows by shamCashTxId
  // (handles case where SC deposit was uploaded first, platform deposit arrives later)
  const platformRowsWithSCTxId = depReconciliation.platformOnly.filter(p => p.shamCashTxId)
  const historicalMatchesByScTxId: HistoricalScIdMatch[] = []
  const consumedHistoricalPlatformIds = new Set<string>()

  if (platformRowsWithSCTxId.length > 0) {
    const scTxIds = platformRowsWithSCTxId.map(p => p.shamCashTxId!).filter(Boolean)
    const historicalPendingByScId = await db.transaction.findMany({
      where: {
        accountId,
        status: TransactionStatus.PENDING_SC,
        type: TransactionType.DEPOSIT,
        shamCashTxId: { in: scTxIds },
      },
      select: { id: true, shamCashTxId: true, amount: true },
    })

    const pendingMap = new Map<string, { id: string; amount: number }>()
    for (const t of historicalPendingByScId) {
      if (t.shamCashTxId) {
        pendingMap.set(t.shamCashTxId, { id: t.id, amount: Number(t.amount) })
      }
    }

    for (const platform of platformRowsWithSCTxId) {
      const pending = pendingMap.get(platform.shamCashTxId!)
      if (!pending) continue

      const diff = Math.abs(pending.amount - platform.amount)
      let matchType: 'MATCHED' | 'DISCREPANCY_SC_HIGHER' | 'DISCREPANCY_P_HIGHER' = 'MATCHED'
      if (diff > 0.001) {
        matchType = pending.amount > platform.amount ? 'DISCREPANCY_SC_HIGHER' : 'DISCREPANCY_P_HIGHER'
      }

      historicalMatchesByScTxId.push({
        pendingTxId: pending.id,
        pendingAmount: pending.amount,
        platformRow: platform,
        matchType,
        diff,
      })
      consumedHistoricalPlatformIds.add(platform.txId)
      usedDepositPlatformIds.add(platform.txId)
    }
  }

  // Remove consumed platform rows from platformOnly list
  depReconciliation.platformOnly = depReconciliation.platformOnly.filter(
    p => !consumedHistoricalPlatformIds.has(p.txId)
  )

  // Track which SC IDs were matched by deposit reconciliation
  const matchedSCByDeposits = new Set<string>()
  for (const pair of depReconciliation.matched) matchedSCByDeposits.add(pair.shamCash.txId)
  for (const d of depReconciliation.discrepancySCHigher) matchedSCByDeposits.add(d.shamCash.txId)
  for (const d of depReconciliation.discrepancyPHigher) matchedSCByDeposits.add(d.shamCash.txId)

  // Build deposit records ──────────────────────────────────────────────
  const records: Array<Record<string, unknown>> = []
  const matchedPairs: Array<[string, string]> = []

  // ── Deposit matched (SC + Platform pairs) ──
  // Copy platform TX ID + User ID onto the SC row so the reconciliation view
  // (which only displays the SC side to avoid duplicate pairs) can show them
  // without needing a reverse relation lookup.
  for (const pair of depReconciliation.matched) {
    const scId = createId()
    const pId = createId()
    records.push({
      id: scId, accountId, batchId, source: TransactionSource.SHAM_CASH, type: TransactionType.DEPOSIT,
      shamCashTxId: pair.shamCash.txId,
      platformTxId: pair.platform.txId, platformUserId: pair.platform.userId,
      amount: pair.shamCash.receivedAmount, currency: pair.shamCash.currency,
      txDateTime: pair.shamCash.txDateTime, status: TransactionStatus.MATCHED,
      rawData: pair.shamCash,
    })
    records.push({
      id: pId, accountId, batchId, source: TransactionSource.PLATFORM, type: TransactionType.DEPOSIT,
      platformTxId: pair.platform.txId, platformUserId: pair.platform.userId, shamCashTxId: pair.platform.shamCashTxId,
      amount: pair.platform.amount, currency: pair.platform.currency, txDateTime: pair.platform.createdAt,
      status: TransactionStatus.MATCHED, rawData: pair.platform,
    })
    matchedPairs.push([scId, pId])
  }

  // ── Deposit SC only ──
  for (const sc of depReconciliation.shamCashOnly) {
    records.push({
      id: createId(), accountId, batchId, source: TransactionSource.SHAM_CASH, type: TransactionType.DEPOSIT,
      shamCashTxId: sc.txId, amount: sc.receivedAmount, currency: sc.currency, txDateTime: sc.txDateTime,
      status: TransactionStatus.PENDING_SC, rawData: sc,
    })
  }

  // ── Deposit internal transfers (own-wallet → own-wallet) ──
  // Tagged with notes='internal-transfer' so the dashboard / profits filter
  // them out and the upload UI can count them separately.
  for (const sc of depReconciliation.internalTransfers) {
    records.push({
      id: createId(), accountId, batchId, source: TransactionSource.SHAM_CASH, type: TransactionType.DEPOSIT,
      shamCashTxId: sc.txId, amount: sc.receivedAmount, currency: sc.currency, txDateTime: sc.txDateTime,
      status: TransactionStatus.PENDING_SC, notes: 'internal-transfer', rawData: sc,
    })
  }

  // ── Deposit Platform only ──
  for (const p of depReconciliation.platformOnly) {
    records.push({
      id: createId(), accountId, batchId, source: TransactionSource.PLATFORM, type: TransactionType.DEPOSIT,
      platformTxId: p.txId, platformUserId: p.userId, shamCashTxId: p.shamCashTxId,
      amount: p.amount, currency: p.currency, txDateTime: p.createdAt, status: TransactionStatus.PENDING_P, rawData: p,
    })
  }

  // ── Deposit discrepancy SC higher ──
  for (const d of depReconciliation.discrepancySCHigher) {
    records.push({
      id: createId(), accountId, batchId, source: TransactionSource.SHAM_CASH, type: TransactionType.DEPOSIT,
      shamCashTxId: d.shamCash.txId, platformTxId: d.platform.txId, platformUserId: d.platform.userId,
      amount: d.shamCash.receivedAmount, currency: d.shamCash.currency, txDateTime: d.shamCash.txDateTime,
      status: TransactionStatus.DISCREPANCY, amountDiff: d.diff,
      rawData: { sc: d.shamCash, platform: d.platform },
    })
  }

  // ── Deposit discrepancy Platform higher ──
  for (const d of depReconciliation.discrepancyPHigher) {
    records.push({
      id: createId(), accountId, batchId, source: TransactionSource.PLATFORM, type: TransactionType.DEPOSIT,
      platformTxId: d.platform.txId, platformUserId: d.platform.userId, shamCashTxId: d.shamCash.txId,
      amount: d.platform.amount, currency: d.platform.currency, txDateTime: d.platform.createdAt,
      status: TransactionStatus.DISCREPANCY, amountDiff: d.diff,
      rawData: { sc: d.shamCash, platform: d.platform },
    })
  }

  return {
    depReconciliation,
    records,
    matchedPairs,
    usedDepositPlatformIds,
    matchedSCByDeposits,
    historicalMatchesByScTxId,
  }
}
