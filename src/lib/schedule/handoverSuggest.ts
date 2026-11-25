// Suggests, for each employee on a shift, which previous-shift employee(s)
// they take over from. Pure + deterministic so the schedule generator and the
// schedule page can both call it and tests can pin the behavior.
//
// Strategy:
//   - When wallets are assigned, pair by wallet COVERAGE: greedily pick the
//     previous-shift employees whose combined wallets best cover the incoming
//     employee's wallets. A taker who holds wallets W needs the union of their
//     handover sources to include all of W.
//   - When no wallets are present anywhere, fall back to INDEX pairing:
//     this-shift employee i ↔ prev-shift employee i.

export interface RosterMember {
  userId: string
  walletIds: string[]
}

// userId → the previous-shift userIds they take over from.
export type HandoverMap = Record<string, string[]>

function intersectionSize(a: Set<string>, bIds: string[]): number {
  let n = 0
  for (const id of bIds) if (a.has(id)) n++
  return n
}

export function suggestHandover(
  thisShift: RosterMember[],
  prevShift: RosterMember[],
): HandoverMap {
  const map: HandoverMap = {}
  if (prevShift.length === 0) {
    for (const m of thisShift) map[m.userId] = []
    return map
  }

  const anyWallets =
    thisShift.some(m => m.walletIds.length > 0) ||
    prevShift.some(m => m.walletIds.length > 0)

  if (!anyWallets) {
    // Index fallback — stable, every taker gets at most one source.
    for (let i = 0; i < thisShift.length; i++) {
      const prev = prevShift[i]
      map[thisShift[i].userId] = prev ? [prev.userId] : []
    }
    return map
  }

  // Wallet-coverage pairing. For each taker, greedily add the prev employee
  // contributing the most still-uncovered wallets, until the taker's wallets
  // are fully covered or no prev employee adds anything new.
  for (const taker of thisShift) {
    const need = new Set(taker.walletIds)
    const sources: string[] = []
    if (need.size === 0) {
      map[taker.userId] = []
      continue
    }
    const pool = [...prevShift]
    while (need.size > 0) {
      let best: RosterMember | null = null
      let bestGain = 0
      for (const cand of pool) {
        if (sources.includes(cand.userId)) continue
        const gain = intersectionSize(need, cand.walletIds)
        if (gain > bestGain) {
          bestGain = gain
          best = cand
        }
      }
      if (!best || bestGain === 0) break // nothing else can help
      sources.push(best.userId)
      for (const w of best.walletIds) need.delete(w)
    }
    map[taker.userId] = sources
  }
  return map
}
