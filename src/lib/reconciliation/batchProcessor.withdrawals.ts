import { createId } from '@paralleldrive/cuid2'
import { reconcileWithdrawals, crossMatchSendsWithDeposits } from '@/lib/reconciliation/withdrawals'
import { reconcileDeposits } from '@/lib/reconciliation/deposits'
import { TransactionStatus, TransactionSource, TransactionType } from '@/lib/db/prisma-types'

type ScRows = Parameters<typeof reconcileWithdrawals>[0]
type WdRows = Parameters<typeof reconcileWithdrawals>[1]
type DepRows = Parameters<typeof reconcileDeposits>[1]
type WdReconciliation = ReturnType<typeof reconcileWithdrawals>
type CrossMatchResult = ReturnType<typeof crossMatchSendsWithDeposits>

export interface WithdrawalStepResult {
  wdReconciliation: WdReconciliation
  crossMatched: CrossMatchResult['crossMatched']
  finalUnmatchedSCSends: CrossMatchResult['stillUnmatched']
  records: Array<Record<string, unknown>>
  matchedPairs: Array<[string, string]>
}

export function runWithdrawalStep(
  accountId: string,
  batchId: string,
  scRows: ScRows,
  wdRows: WdRows,
  depRows: DepRows,
  walletIdentifiers: string[],
  matchedSCByDeposits: Set<string>,
  usedDepositPlatformIds: Set<string>,
): WithdrawalStepResult {
  // 5. Run withdrawal reconciliation (ارسال vs epayquery — by time+amount)
  // Pass already matched SC IDs so they're excluded
  const wdReconciliation = reconcileWithdrawals(
    scRows,
    wdRows,
    walletIdentifiers,
    matchedSCByDeposits
  )

  // 6. Cross-match: unmatched ارسال from SC → try against epaylist (by time+amount)
  // Some sends from SC are part of the deposit cycle, not withdrawals
  const { crossMatched, stillUnmatched: finalUnmatchedSCSends } = crossMatchSendsWithDeposits(
    wdReconciliation.shamCashOnly,
    depRows,
    usedDepositPlatformIds
  )

  const records: Array<Record<string, unknown>> = []
  const matchedPairs: Array<[string, string]> = []

  // ── Withdrawal matched ──
  // Also copy platform TX ID + User ID onto the SC row for display.
  for (const pair of wdReconciliation.matched) {
    const scId = createId()
    const pId = createId()
    records.push({
      id: scId, accountId, batchId, source: TransactionSource.SHAM_CASH, type: TransactionType.WITHDRAWAL,
      shamCashTxId: pair.shamCash.txId,
      platformTxId: pair.platform.txId, platformUserId: pair.platform.userId,
      amount: pair.shamCash.sentAmount, currency: pair.shamCash.currency,
      txDateTime: pair.shamCash.txDateTime, status: TransactionStatus.MATCHED,
      rawData: pair.shamCash,
    })
    records.push({
      id: pId, accountId, batchId, source: TransactionSource.PLATFORM, type: TransactionType.WITHDRAWAL,
      platformTxId: pair.platform.txId, platformUserId: pair.platform.userId,
      amount: pair.platform.amount, currency: pair.platform.currency, txDateTime: pair.platform.withdrawalTime,
      status: TransactionStatus.MATCHED, rawData: pair.platform,
    })
    matchedPairs.push([scId, pId])
  }

  // ── Cross-matched ──
  for (const cm of crossMatched) {
    const scId = createId()
    const pId = createId()
    records.push({
      id: scId, accountId, batchId, source: TransactionSource.SHAM_CASH, type: TransactionType.DEPOSIT,
      shamCashTxId: cm.shamCash.txId,
      platformTxId: cm.platform.txId, platformUserId: cm.platform.userId,
      amount: cm.shamCash.sentAmount, currency: cm.shamCash.currency,
      txDateTime: cm.shamCash.txDateTime, status: TransactionStatus.MATCHED, notes: 'cross-matched',
      rawData: cm.shamCash,
    })
    records.push({
      id: pId, accountId, batchId, source: TransactionSource.PLATFORM, type: TransactionType.DEPOSIT,
      platformTxId: cm.platform.txId, platformUserId: cm.platform.userId,
      amount: cm.platform.amount, currency: cm.platform.currency, txDateTime: cm.platform.createdAt,
      status: TransactionStatus.MATCHED, notes: 'cross-matched', rawData: cm.platform,
    })
    matchedPairs.push([scId, pId])
  }

  // ── Withdrawal SC only ──
  for (const sc of finalUnmatchedSCSends) {
    records.push({
      id: createId(), accountId, batchId, source: TransactionSource.SHAM_CASH, type: TransactionType.WITHDRAWAL,
      shamCashTxId: sc.txId, amount: sc.sentAmount, currency: sc.currency, txDateTime: sc.txDateTime,
      status: TransactionStatus.PENDING_SC, rawData: sc,
    })
  }

  // ── Internal transfers (own-wallet → own-wallet) ──
  // These are SC sends to one of the account's walletIdentifiers — not real
  // customer withdrawals. Persist as PENDING_SC with notes flag so the UI can
  // identify and exclude them from "needs review" lists.
  for (const sc of wdReconciliation.internalTransfers) {
    records.push({
      id: createId(), accountId, batchId, source: TransactionSource.SHAM_CASH, type: TransactionType.WITHDRAWAL,
      shamCashTxId: sc.txId, amount: sc.sentAmount, currency: sc.currency, txDateTime: sc.txDateTime,
      status: TransactionStatus.PENDING_SC, notes: 'internal-transfer', rawData: sc,
    })
  }

  // ── Withdrawal Platform only ──
  for (const p of wdReconciliation.platformOnly) {
    records.push({
      id: createId(), accountId, batchId, source: TransactionSource.PLATFORM, type: TransactionType.WITHDRAWAL,
      platformTxId: p.txId, platformUserId: p.userId,
      amount: p.amount, currency: p.currency, txDateTime: p.withdrawalTime, status: TransactionStatus.PENDING_P, rawData: p,
    })
  }

  // ── Withdrawal discrepancy SC higher ──
  for (const d of wdReconciliation.discrepancySCHigher) {
    records.push({
      id: createId(), accountId, batchId, source: TransactionSource.SHAM_CASH, type: TransactionType.WITHDRAWAL,
      shamCashTxId: d.shamCash.txId, platformTxId: d.platform.txId, platformUserId: d.platform.userId,
      amount: d.shamCash.sentAmount, currency: d.shamCash.currency, txDateTime: d.shamCash.txDateTime,
      status: TransactionStatus.DISCREPANCY, amountDiff: d.diff,
      rawData: { sc: d.shamCash, platform: d.platform },
    })
  }

  // ── Withdrawal discrepancy Platform higher ──
  for (const d of wdReconciliation.discrepancyPHigher) {
    records.push({
      id: createId(), accountId, batchId, source: TransactionSource.PLATFORM, type: TransactionType.WITHDRAWAL,
      shamCashTxId: d.shamCash.txId, platformTxId: d.platform.txId, platformUserId: d.platform.userId,
      amount: d.platform.amount, currency: d.platform.currency, txDateTime: d.platform.withdrawalTime,
      status: TransactionStatus.DISCREPANCY, amountDiff: d.diff,
      rawData: { sc: d.shamCash, platform: d.platform },
    })
  }

  return { wdReconciliation, crossMatched, finalUnmatchedSCSends, records, matchedPairs }
}
