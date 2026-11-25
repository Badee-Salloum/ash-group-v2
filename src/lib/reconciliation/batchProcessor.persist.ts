import { db } from '@/lib/db/client'
import { linkAutomaticPairs } from './autoLink'

// Never delete old pending rows to replace them. Reuse only unreviewed,
// unlinked rows; the atomic linker rechecks their live state before claiming.
export async function dedupAgainstExisting(accountId: string, records: Array<Record<string, unknown>>, pairs: Array<[string, string]>) {
  if (!records.length) return 0
  const existing = await db.transaction.findMany({ where: { accountId, OR: [
    { source: 'SHAM_CASH', shamCashTxId: { in: records.filter(r => r.source === 'SHAM_CASH' && r.shamCashTxId).map(r => String(r.shamCashTxId)) } },
    { source: 'PLATFORM', platformTxId: { in: records.filter(r => r.source === 'PLATFORM' && r.platformTxId).map(r => String(r.platformTxId)) } },
  ] }, select: { id: true, source: true, type: true, currency: true, status: true, reviewCategory: true, matchedTxId: true, shamCashTxId: true, platformTxId: true } })
  const key = (r: Record<string, unknown>) => r.source + ':' + (r.source === 'SHAM_CASH' ? r.shamCashTxId : r.platformTxId)
  const byKey = new Map<string, Array<Record<string, unknown>>>()
  for (const row of existing) byKey.set(key(row), [...(byKey.get(key(row)) || []), row])
  const replacement = new Map<string, string>()
  const blocked = new Set<string>()
  const dropped = new Set<string>()
  const pairedIds = new Set(pairs.flat())
  for (const record of records) {
    const rows = byKey.get(key(record))
    if (!rows?.length) continue
    const row = rows[0]
    dropped.add(String(record.id))
    if (rows.length === 1 && !row.matchedTxId && !row.reviewCategory && row.type === record.type && row.currency === record.currency
      && row.status === (row.source === 'PLATFORM' ? 'PENDING_P' : 'PENDING_SC') && pairedIds.has(String(record.id))) {
      replacement.set(String(record.id), String(row.id))
    } else blocked.add(String(record.id))
  }
  const accepted: Array<[string, string]> = []
  for (const [a,b] of pairs) {
    if (blocked.has(a) || blocked.has(b)) {
      // Preserve the new counterpart as pending instead of silently losing it.
      for (const id of [a,b]) {
        const row = records.find(r => r.id === id)
        if (row && !dropped.has(id)) { row.status = row.source === 'PLATFORM' ? 'PENDING_P' : 'PENDING_SC'; row.amountDiff = null }
      }
    } else accepted.push([replacement.get(a) || a, replacement.get(b) || b])
  }
  const before = records.length
  const kept = records.filter(r => !dropped.has(String(r.id)))
  records.splice(0, records.length, ...kept)
  pairs.splice(0, pairs.length, ...accepted)
  return before - records.length
}

export async function bulkInsertRecords(records: Array<Record<string, unknown>>, client: typeof db = db) {
  if (records.length) await client.transaction.createMany({ data: records })
}
export async function linkMatchedPairs(pairs: Array<[string, string]>, client?: typeof db) {
  await linkAutomaticPairs(pairs, 'NEW_BATCH', client)
}

// Individual automatic claims are atomic. A later-stage failure must NOT erase
// evidence, delete already-linked historical counterparts, or claim a full undo.
export async function rollbackBatch(batchId: string, _error: unknown) {
  const rowsProcessed = await db.transaction.count({ where: { batchId } })
  await db.uploadBatch.update({ where: { id: batchId }, data: {
    status: 'FAILED', processedAt: new Date(), rowsProcessed,
    errorLog: 'فشلت مرحلة من المعالجة. حُفظت النتائج الملتزمة وسجل التدقيق؛ يلزم التحقق قبل إعادة الرفع.',
  } })
}

