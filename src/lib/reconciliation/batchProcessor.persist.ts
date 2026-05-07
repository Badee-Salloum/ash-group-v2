import { db } from '@/lib/db/client'
import { TransactionSource } from '@/lib/db/prisma-types'

// ── Deduplicate against existing DB rows ──
// Avoid re-inserting operations that were added by a previous upload.
//   - SHAM_CASH rows: identified by shamCashTxId (unique per account).
//   - PLATFORM rows: identified by platformTxId (unique per account).
// Any record whose identifying ID already exists in the DB for this account
// is skipped. This makes re-uploads idempotent.
export async function dedupAgainstExisting(
  accountId: string,
  allRecords: Array<Record<string, unknown>>,
  matchedPairs: Array<[string, string]>,
): Promise<number> {
  let skippedAsDuplicate = 0
  if (allRecords.length === 0) return skippedAsDuplicate

  const scIdsInBatch = Array.from(new Set(
    allRecords
      .filter(r => r.source === TransactionSource.SHAM_CASH && r.shamCashTxId)
      .map(r => String(r.shamCashTxId))
  ))
  const pIdsInBatch = Array.from(new Set(
    allRecords
      .filter(r => r.source === TransactionSource.PLATFORM && r.platformTxId)
      .map(r => String(r.platformTxId))
  ))

  // Pull existing rows with their status — we need it to decide between
  // "true duplicate" (existing is MATCHED → drop the new record) and
  // "stale pending" (existing is PENDING_SC/PENDING_P → delete the old row
  // and let the new MATCHED/DISCREPANCY record win).
  const [existingSC, existingP] = await Promise.all([
    scIdsInBatch.length > 0
      ? db.transaction.findMany({
          where: {
            accountId,
            source: TransactionSource.SHAM_CASH,
            shamCashTxId: { in: scIdsInBatch },
          },
          select: { id: true, shamCashTxId: true, status: true, matchedTxId: true },
        })
      : Promise.resolve([] as Array<{ id: string; shamCashTxId: string | null; status: string; matchedTxId: string | null }>),
    pIdsInBatch.length > 0
      ? db.transaction.findMany({
          where: {
            accountId,
            source: TransactionSource.PLATFORM,
            platformTxId: { in: pIdsInBatch },
          },
          select: { id: true, platformTxId: true, status: true, matchedTxId: true },
        })
      : Promise.resolve([] as Array<{ id: string; platformTxId: string | null; status: string; matchedTxId: string | null }>),
  ])

  // Split existing rows: PENDING ones we'll DELETE before insert, so the
  // new (presumably MATCHED) records can take their place.
  type ExSc = { id: string; shamCashTxId: string | null; status: string; matchedTxId: string | null }
  type ExPl = { id: string; platformTxId: string | null; status: string; matchedTxId: string | null }
  const scStaleIds: string[] = []
  const plStaleIds: string[] = []
  const existingScSet = new Set<string>()
  const existingPSet = new Set<string>()
  for (const r of (existingSC as ExSc[])) {
    if (!r.shamCashTxId) continue
    if (r.status === 'PENDING_SC' || r.status === 'PENDING_P') {
      scStaleIds.push(r.id)
    } else {
      existingScSet.add(r.shamCashTxId)
    }
  }
  for (const r of (existingP as ExPl[])) {
    if (!r.platformTxId) continue
    if (r.status === 'PENDING_SC' || r.status === 'PENDING_P') {
      plStaleIds.push(r.id)
    } else {
      existingPSet.add(r.platformTxId)
    }
  }

  // Delete stale PENDING rows (and any existing matched partner) so the
  // refreshed records can be inserted cleanly.
  if (scStaleIds.length > 0 || plStaleIds.length > 0) {
    const staleAll = [...scStaleIds, ...plStaleIds]
    // Break FK cycles before delete
    await db.transaction.updateMany({
      where: { id: { in: staleAll } },
      data: { matchedTxId: null },
    })
    await db.transaction.deleteMany({ where: { id: { in: staleAll } } })
  }

  if (existingScSet.size > 0 || existingPSet.size > 0) {
    const droppedIds = new Set<string>()
    const before = allRecords.length
    const kept = allRecords.filter(r => {
      if (r.source === TransactionSource.SHAM_CASH && r.shamCashTxId && existingScSet.has(String(r.shamCashTxId))) {
        droppedIds.add(String(r.id))
        return false
      }
      if (r.source === TransactionSource.PLATFORM && r.platformTxId && existingPSet.has(String(r.platformTxId))) {
        droppedIds.add(String(r.id))
        return false
      }
      return true
    })
    // If one side of a matched pair was dropped, drop the other too so we
    // don't leave an orphan MATCHED row pointing at nothing.
    const finalRecords = kept.filter(r => {
      const pair = matchedPairs.find(p => p[0] === r.id || p[1] === r.id)
      if (!pair) return true
      return !droppedIds.has(pair[0]) && !droppedIds.has(pair[1])
    })
    // Also prune matchedPairs whose partners were dropped
    const finalPairs = matchedPairs.filter(p =>
      !droppedIds.has(p[0]) && !droppedIds.has(p[1])
    )
    matchedPairs.length = 0
    for (const p of finalPairs) matchedPairs.push(p)

    skippedAsDuplicate = before - finalRecords.length
    allRecords.length = 0
    for (const r of finalRecords) allRecords.push(r)
  }

  return skippedAsDuplicate
}

// BULK INSERT all remaining records at once
export async function bulkInsertRecords(allRecords: Array<Record<string, unknown>>): Promise<void> {
  if (allRecords.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.transaction.createMany({ data: allRecords as any })
  }
}

// Link matched pairs via matchedTxId in a second pass to avoid FK violations
// (Postgres checks FKs per-row during INSERT; forward references fail).
// Use a single raw SQL statement with CASE to do ALL pair updates at once —
// avoids exhausting the connection pool (limit=5) on large batches.
export async function linkMatchedPairs(matchedPairs: Array<[string, string]>): Promise<void> {
  if (matchedPairs.length === 0) return
  const allIds: string[] = []
  const caseLines: string[] = []
  for (const [a, b] of matchedPairs) {
    allIds.push(a, b)
    caseLines.push(`WHEN '${a}' THEN '${b}'`)
    caseLines.push(`WHEN '${b}' THEN '${a}'`)
  }
  const idList = allIds.map(id => `'${id}'`).join(',')
  const caseSQL = caseLines.join(' ')
  await db.$executeRawUnsafe(
    `UPDATE "transactions" SET "matchedTxId" = CASE "id" ${caseSQL} END WHERE "id" IN (${idList})`
  )
}

// ── Full rollback on any failure ──
// Remove every row written under this batch so the database stays in a
// consistent state, then remove the batch record itself. We also clean up
// any CONSOLIDATE_PAIR audit entries tied to this batch (normally none,
// because consolidation runs after the try block, but defensive).
export async function rollbackBatch(batchId: string, error: unknown): Promise<void> {
  console.error(`Batch ${batchId} failed — rolling back:`, error)
  try {
    // Delete consolidation audit entries tied to this batch (if any were made)
    await db.$executeRawUnsafe(
      `DELETE FROM "audit_logs"
       WHERE action = 'CONSOLIDATE_PAIR'
         AND details->>'batchId' = $1`,
      batchId
    )
    // Break FK cycles: clear matchedTxId on all rows in this batch before deletion
    await db.transaction.updateMany({
      where: { batchId },
      data: { matchedTxId: null },
    })
    // Delete all transactions tied to this batch
    await db.transaction.deleteMany({ where: { batchId } })
    // Delete the batch record itself
    await db.uploadBatch.delete({ where: { id: batchId } })
    console.log(`Batch ${batchId} rollback completed — all changes undone.`)
  } catch (rollbackErr) {
    console.error(`Rollback of batch ${batchId} also failed:`, rollbackErr)
    // Best-effort: mark batch FAILED with both errors so the user sees something
    try {
      await db.uploadBatch.update({
        where: { id: batchId },
        data: {
          status: 'FAILED',
          errorLog: `Original: ${String(error)}\nRollback error: ${String(rollbackErr)}`,
        },
      })
    } catch {
      // if even the status update fails, just swallow — we'll still throw below
    }
  }
}
