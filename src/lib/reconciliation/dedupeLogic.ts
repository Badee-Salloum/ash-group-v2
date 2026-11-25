// Pure dedupe decision logic, extracted from batchProcessor.persist.ts so it
// can be unit-tested directly without spinning up a database.

export interface ExistingRow {
  id: string
  status: string
}

// Split existing rows into:
//   - stale: PENDING_SC / PENDING_P → the OLD row will be deleted, new one wins
//   - kept:  MATCHED / DISCREPANCY / WASTE → old row stays, NEW row is dropped
//
// The kept set is returned by identifier (shamCashTxId or platformTxId) so the
// caller can filter the incoming batch.
export function categorizeExisting<T extends ExistingRow & { idKey: string | null }>(
  rows: T[],
): { staleIds: string[]; keptKeys: Set<string> } {
  const staleIds: string[] = []
  const keptKeys = new Set<string>()
  for (const r of rows) {
    if (!r.idKey) continue
    if (r.status === 'PENDING_SC' || r.status === 'PENDING_P') {
      staleIds.push(r.id)
    } else {
      keptKeys.add(r.idKey)
    }
  }
  return { staleIds, keptKeys }
}

// When a record in a matched pair is dropped (because its partner already
// exists in DB), the surviving partner becomes an orphan MATCHED row pointing
// at nothing. To prevent that, drop both sides of any pair where either id is
// in the droppedIds set.
export function pruneOrphanPairs<T extends { id: string }>(
  records: T[],
  droppedIds: ReadonlySet<string>,
  matchedPairs: ReadonlyArray<readonly [string, string]>,
): T[] {
  return records.filter(r => {
    const pair = matchedPairs.find(p => p[0] === r.id || p[1] === r.id)
    if (!pair) return true
    return !droppedIds.has(pair[0]) && !droppedIds.has(pair[1])
  })
}

// Remove pairs whose partners were dropped. Used to keep matchedPairs in sync
// with the surviving records list.
export function prunePairs(
  matchedPairs: ReadonlyArray<readonly [string, string]>,
  droppedIds: ReadonlySet<string>,
): Array<[string, string]> {
  return matchedPairs
    .filter(p => !droppedIds.has(p[0]) && !droppedIds.has(p[1]))
    .map(p => [p[0], p[1]] as [string, string])
}
