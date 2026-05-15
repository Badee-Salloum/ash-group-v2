import {
  ShamCashRow,
  PlatformWithdrawalRow,
  PlatformDepositRow,
  WithdrawalReconciliationResult,
  WithdrawalMatchedPair,
  WithdrawalDiscrepancy,
} from '@/types'
import { isInternalTransfer, isSpuriousInternalPair } from './walletMatch'

// NOTE: time-based matching has been DISABLED globally per request.
// Withdrawals now only match via the explicit BankTranferComment / shamCashTxId
// link extracted from the platform's User info. Anything without that link
// stays unmatched (PENDING_SC / PENDING_P) for manual resolution via
// suggest-match. This eliminates false positives from coincidental time+amount
// collisions.
const AMOUNT_TOLERANCE = 0.001

function getTimeDiffSeconds(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 1000
}

export function reconcileWithdrawals(
  shamCashRows: ShamCashRow[],
  platformRows: PlatformWithdrawalRow[],
  walletIdentifiers: string[] = [],
  alreadyMatchedSCIds: Set<string> = new Set()
): WithdrawalReconciliationResult {
  // Only withdrawals (ارسال) from Sham Cash, excluding already matched by deposit reconciliation
  const allScWithdrawals = shamCashRows.filter(r => r.type === 'WITHDRAWAL' && !alreadyMatchedSCIds.has(r.txId))

  const matched: WithdrawalMatchedPair[] = []
  const discrepancySCHigher: WithdrawalDiscrepancy[] = []
  const discrepancyPHigher: WithdrawalDiscrepancy[] = []
  const usedSCIds = new Set<string>()
  const usedPlatformIds = new Set<string>()

  // For each platform withdrawal, find SC candidates within time window.
  // Match against "Time of payout" only (Time of withdrawal is ignored).
  const wdTimeDiff = (scTime: Date, platform: PlatformWithdrawalRow) =>
    getTimeDiffSeconds(scTime, platform.payoutTime)

  // ── Phase 1: Match by shamCashTxId (extracted from BankTranferComment) ──
  // Match-first, classify-later: include ALL SC withdrawals (even ones that
  // look like internal transfers by sender name). Real BankTranferComment
  // links override the heuristic.
  const scByTxId = new Map<string, ShamCashRow>()
  for (const sc of allScWithdrawals) scByTxId.set(sc.txId, sc)

  for (const platform of platformRows) {
    const scId = platform.shamCashTxId
    if (!scId) continue
    const sc = scByTxId.get(scId)
    if (!sc || usedSCIds.has(sc.txId)) continue
    const scCurrency = (sc.currency || 'USD').toUpperCase()
    const pCurrency = (platform.currency || 'USD').toUpperCase()
    if (scCurrency !== pCurrency) continue

    const scAmount = sc.sentAmount
    const pAmount = platform.amount

    // Reject spurious TX-ID matches: SC looks internal AND amounts diverge
    // wildly. Leave both sides unmatched — SC will land in internalTransfers
    // in Phase 2, platform in platformOnly. Prevents 440-vs-15 false pairs.
    if (isSpuriousInternalPair({
      scAccountNumber: sc.accountNumber, scAccountName: sc.accountName, scNotes: sc.notes,
      walletIdentifiers, scAmount, pAmount,
    })) {
      continue
    }

    const diff = Math.abs(scAmount - pAmount)
    usedSCIds.add(sc.txId)
    usedPlatformIds.add(platform.txId)

    if (diff <= AMOUNT_TOLERANCE) {
      matched.push({ shamCash: sc, platform, timeDiffSeconds: wdTimeDiff(sc.txDateTime, platform) })
    } else if (scAmount > pAmount) {
      discrepancySCHigher.push({
        shamCash: sc, platform, diff: scAmount - pAmount,
        timeDiffSeconds: wdTimeDiff(sc.txDateTime, platform),
      })
    } else {
      discrepancyPHigher.push({
        shamCash: sc, platform, diff: pAmount - scAmount,
        timeDiffSeconds: wdTimeDiff(sc.txDateTime, platform),
      })
    }
  }

  // ── Phase 2 (time+amount matching) is DISABLED ──
  // Anything not matched by Phase 1 stays unmatched. The user can resolve
  // remaining PENDING rows manually via the suggest-match UI.

  // Phase 2: Classify the unmatched SC withdrawals — internal vs. truly
  // orphaned. A SC row that found a real platform partner via TX ID is NEVER
  // marked internal even if its sender name overlaps with walletIdentifiers.
  const shamCashOnly: ShamCashRow[] = []
  const internalTransfers: ShamCashRow[] = []
  for (const sc of allScWithdrawals) {
    if (usedSCIds.has(sc.txId)) continue
    if (isInternalTransfer(sc.accountNumber, sc.accountName, sc.notes, walletIdentifiers)) {
      internalTransfers.push(sc)
    } else {
      shamCashOnly.push(sc)
    }
  }

  // Unmatched platform withdrawals
  const platformOnly = platformRows.filter(p => !usedPlatformIds.has(p.txId))

  return {
    matched,
    shamCashOnly,
    platformOnly,
    discrepancySCHigher,
    discrepancyPHigher,
    internalTransfers,
  }
}

// ─── Cross-match: try SC ارسال against epaylist (deposits) by time+amount ────
export function crossMatchSendsWithDeposits(
  unmatchedSCSends: ShamCashRow[],
  platformDeposits: PlatformDepositRow[],
  alreadyUsedDepositIds: Set<string>
): {
  crossMatched: Array<{ shamCash: ShamCashRow; platform: PlatformDepositRow; timeDiffSeconds: number }>
  stillUnmatched: ShamCashRow[]
} {
  // Cross-matching SC sends with platform deposits — DETERMINISTIC by TX ID
  // only. (The old time+amount heuristic was disabled per request.) Pairs
  // SC `ارسال` rows with platform deposit rows whose User info contains
  // `BankTranferComment: <SC_TX_ID>` or `ext_trn_id: <SC_TX_ID>`. Same
  // currency required. Amount mismatch still produces a cross-match (the
  // discrepancy will surface elsewhere).
  const crossMatched: Array<{ shamCash: ShamCashRow; platform: PlatformDepositRow; timeDiffSeconds: number }> = []
  const usedSCIds = new Set<string>()
  const usedDepIds = new Set<string>(alreadyUsedDepositIds)

  // Build SC lookup by txId
  const scByTxId = new Map<string, ShamCashRow>()
  for (const sc of unmatchedSCSends) scByTxId.set(sc.txId, sc)

  for (const dep of platformDeposits) {
    if (usedDepIds.has(dep.txId)) continue
    const scId = dep.shamCashTxId
    if (!scId) continue
    const sc = scByTxId.get(scId)
    if (!sc || usedSCIds.has(sc.txId)) continue

    const scCurrency = (sc.currency || 'USD').toUpperCase()
    const depCurrency = (dep.currency || 'USD').toUpperCase()
    if (scCurrency !== depCurrency) continue

    usedSCIds.add(sc.txId)
    usedDepIds.add(dep.txId)
    crossMatched.push({ shamCash: sc, platform: dep, timeDiffSeconds: 0 })
  }

  const stillUnmatched = unmatchedSCSends.filter(sc => !usedSCIds.has(sc.txId))
  return { crossMatched, stillUnmatched }
}

// ─── Manual resolution: link platform P-higher with SC-only ─────────────────
export function resolveManualWithdrawal(
  platformTxId: string,
  shamCashTxId: string,
  scWithdrawalsOnly: ShamCashRow[],
  platformDiscrepancy: WithdrawalDiscrepancy[]
): { resolved: boolean; pair?: WithdrawalMatchedPair } {
  const sc = scWithdrawalsOnly.find(s => s.txId === shamCashTxId)
  const pd = platformDiscrepancy.find(d => d.platform.txId === platformTxId)

  if (!sc || !pd) return { resolved: false }

  return {
    resolved: true,
    pair: {
      shamCash: sc,
      platform: pd.platform,
      timeDiffSeconds: getTimeDiffSeconds(sc.txDateTime, pd.platform.payoutTime),
    },
  }
}
