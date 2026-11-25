import {
  ShamCashRow,
  PlatformDepositRow,
  ReconciliationResult,
  MatchedPair,
  DiscrepancyItem,
} from '@/types'
import { isInternalTransfer, isSpuriousInternalPair } from './walletMatch'
import { sameCurrency, uniqueAutoCandidates, currencyMatchKey } from './currencyGuard'

const AMOUNT_TOLERANCE = 0.001 // floating point tolerance

export function reconcileDeposits(
  shamCashRows: ShamCashRow[],
  platformRows: PlatformDepositRow[],
  walletIdentifiers: string[] = []
): ReconciliationResult {
  const allScDeposits = shamCashRows.filter(r => r.type === 'DEPOSIT')

  // Build lookup maps from ALL SC deposits — match-first, classify-later.
  // Previously we removed "internal transfer" SC rows BEFORE attempting to
  // match by TX ID, which caused false-positive internals (sender name
  // happens to overlap with a wallet identifier) to be removed even though
  // they had a real platform partner.
  const scByTxId = uniqueAutoCandidates(allScDeposits, row => row.txId)
  const uniquePlatform = uniqueAutoCandidates(platformRows, row => row.txId)
  const platformByScTxId = uniqueAutoCandidates(platformRows.filter(row => uniquePlatform.get(row.txId) === row),
    row => row.shamCashTxId ? currencyMatchKey(row.shamCashTxId, row.currency) : null)

  const matched: MatchedPair[] = []
  const discrepancySCHigher: DiscrepancyItem[] = []
  const discrepancyPHigher: DiscrepancyItem[] = []
  const shamCashOnly: ShamCashRow[] = []
  const internalTransfers: ShamCashRow[] = []
  const resolvedFromComplaint: MatchedPair[] = []
  const usedPlatformTxIds = new Set<string>()
  const matchedScIds = new Set<string>()

  // Phase 1: Match by SC TX ID (only if same currency). Operates on ALL SC
  // deposits — even those that look like internal transfers. If a row has a
  // real platform partner, it's a real customer deposit, period.
  for (const sc of allScDeposits) {
    if (scByTxId.get(sc.txId) !== sc) continue
    const platform = platformByScTxId.get(currencyMatchKey(sc.txId, sc.currency))
    if (!platform || usedPlatformTxIds.has(platform.txId)) continue
    if (!sameCurrency(sc.currency, platform.currency)) continue

    const scAmount = sc.receivedAmount
    const pAmount = platform.amount

    // Reject spurious TX-ID matches: SC looks internal AND amounts diverge
    // wildly. Leave both sides unmatched — SC will land in internalTransfers
    // in Phase 2, platform in platformOnly.
    if (isSpuriousInternalPair({
      scAccountNumber: sc.accountNumber, scAccountName: sc.accountName, scNotes: sc.notes,
      walletIdentifiers, scAmount, pAmount,
    })) {
      continue
    }

    usedPlatformTxIds.add(platform.txId)
    matchedScIds.add(sc.txId)
    const diff = Math.abs(scAmount - pAmount)

    if (diff <= AMOUNT_TOLERANCE) {
      matched.push({ shamCash: sc, platform })
    } else if (scAmount > pAmount) {
      discrepancySCHigher.push({ shamCash: sc, platform, diff: scAmount - pAmount })
    } else {
      discrepancyPHigher.push({ shamCash: sc, platform, diff: pAmount - scAmount })
    }
  }

  // Phase 2: Classify the SC deposits that DIDN'T match. Internal-transfer
  // detection now applies only to truly-orphaned SC rows.
  for (const sc of allScDeposits) {
    if (matchedScIds.has(sc.txId)) continue
    if (isInternalTransfer(sc.accountNumber, sc.accountName, sc.notes, walletIdentifiers)) {
      internalTransfers.push(sc)
    } else {
      shamCashOnly.push(sc)
    }
  }

  // Phase 3: Remaining platform rows with no SC match
  const platformOnly: PlatformDepositRow[] = platformRows.filter(
    p => !usedPlatformTxIds.has(p.txId)
  )

  return {
    matched,
    shamCashOnly,
    platformOnly,
    resolvedFromComplaint,
    discrepancySCHigher,
    discrepancyPHigher,
    internalTransfers,
  }
}

// ─── Resolve historical PENDING_SC against new platform deposits ─────────────
// Called during batch processing to match old pending SC rows with new platform rows
export function resolveHistoricalComplaints(
  pendingSCTransactions: Array<{
    id: string
    platformUserId: string | null
    amount: number
    currency: string
    txDateTime: Date
  }>,
  newPlatformDeposits: PlatformDepositRow[]
): Array<{ pendingTxId: string; platformRow: PlatformDepositRow }> {
  const resolved: Array<{ pendingTxId: string; platformRow: PlatformDepositRow }> = []

  // A complaint candidate must be unique in BOTH directions; otherwise leave
  // it for review instead of assigning whichever row happens to come first.
  const platformByUserId = new Map<string, PlatformDepositRow[]>()
  const uniquePlatforms = uniqueAutoCandidates(newPlatformDeposits, row => row.txId)
  const pendingByUserId = new Map<string, typeof pendingSCTransactions>()
  for (const pending of pendingSCTransactions) {
    if (!pending.platformUserId) continue
    const group = pendingByUserId.get(pending.platformUserId) || []
    group.push(pending)
    pendingByUserId.set(pending.platformUserId, group)
  }
  for (const p of newPlatformDeposits) {
    if (!p.userId || uniquePlatforms.get(p.txId) !== p) continue
    const existing = platformByUserId.get(p.userId) || []
    existing.push(p)
    platformByUserId.set(p.userId, existing)
  }

  for (const pending of pendingSCTransactions) {
    if (!pending.platformUserId) continue
    const candidates = platformByUserId.get(pending.platformUserId) || []

    const eligible = candidates.filter(candidate => !candidate.shamCashTxId && sameCurrency(candidate.currency, pending.currency)
      && Math.abs(candidate.amount - pending.amount) <= AMOUNT_TOLERANCE)
    if (eligible.length !== 1) continue
    const candidate = eligible[0]
    const reverse = (pendingByUserId.get(pending.platformUserId) || []).filter(other => other.platformUserId === pending.platformUserId
      && sameCurrency(other.currency, candidate.currency) && Math.abs(other.amount - candidate.amount) <= AMOUNT_TOLERANCE)
    if (reverse.length !== 1) continue
    {
      // Match by userId + same amount + no SC TX ID (came from complaint flow)
      if (
        !candidate.shamCashTxId &&
        sameCurrency(candidate.currency, pending.currency) &&
        Math.abs(candidate.amount - pending.amount) <= AMOUNT_TOLERANCE
      ) {
        resolved.push({ pendingTxId: pending.id, platformRow: candidate })
        // Remove from candidates to avoid double-matching
        const idx = candidates.indexOf(candidate)
        candidates.splice(idx, 1)
      }
    }
  }

  return resolved
}
