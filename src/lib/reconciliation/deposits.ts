import {
  ShamCashRow,
  PlatformDepositRow,
  ReconciliationResult,
  MatchedPair,
  DiscrepancyItem,
} from '@/types'
import { isInternalTransfer, isSpuriousInternalPair } from './walletMatch'

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
  const scByTxId = new Map<string, ShamCashRow>()
  for (const sc of allScDeposits) scByTxId.set(sc.txId, sc)

  const platformByScTxId = new Map<string, PlatformDepositRow>()
  for (const p of platformRows) {
    if (p.shamCashTxId) platformByScTxId.set(p.shamCashTxId, p)
  }

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
    const platform = platformByScTxId.get(sc.txId)
    if (!platform) continue
    const scCurrency = (sc.currency || 'USD').toUpperCase()
    const pCurrency = (platform.currency || 'USD').toUpperCase()
    if (scCurrency !== pCurrency) continue

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
    txDateTime: Date
  }>,
  newPlatformDeposits: PlatformDepositRow[]
): Array<{ pendingTxId: string; platformRow: PlatformDepositRow }> {
  const resolved: Array<{ pendingTxId: string; platformRow: PlatformDepositRow }> = []

  // Group platform deposits by userId
  const platformByUserId = new Map<string, PlatformDepositRow[]>()
  for (const p of newPlatformDeposits) {
    if (!p.userId) continue
    const existing = platformByUserId.get(p.userId) || []
    existing.push(p)
    platformByUserId.set(p.userId, existing)
  }

  for (const pending of pendingSCTransactions) {
    if (!pending.platformUserId) continue
    const candidates = platformByUserId.get(pending.platformUserId) || []

    for (const candidate of candidates) {
      // Match by userId + same amount + no SC TX ID (came from complaint flow)
      if (
        !candidate.shamCashTxId &&
        Math.abs(candidate.amount - pending.amount) <= AMOUNT_TOLERANCE
      ) {
        resolved.push({ pendingTxId: pending.id, platformRow: candidate })
        // Remove from candidates to avoid double-matching
        const idx = candidates.indexOf(candidate)
        candidates.splice(idx, 1)
        break
      }
    }
  }

  return resolved
}
