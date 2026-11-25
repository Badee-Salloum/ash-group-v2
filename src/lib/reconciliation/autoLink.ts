import { db } from '@/lib/db/client'
import { getAuditMetadata } from '@/lib/audit/context'
import type { ChangedTransaction } from '@/lib/performance/readModels'

export class AutoMatchConflict extends Error {
  constructor() { super('تعارض في المطابقة التلقائية؛ تُركت العملية دون إعادة إسناد') }
}

export function assertDisjointPairs(pairs: ReadonlyArray<readonly [string, string]>) {
  const seen = new Set<string>()
  for (const [a, b] of pairs) {
    if (!a || !b || a === b || seen.has(a) || seen.has(b)) throw new AutoMatchConflict()
    seen.add(a); seen.add(b)
  }
}

/** Only automatic workflows call this helper. Manual matching is unchanged.
 * Locks both sides in a deterministic order, validates live rows, claims each
 * side once, and journals the actual before/after state in the SAME transaction.
 */
export async function linkAutomaticPairs(
  pairs: ReadonlyArray<readonly [string, string]>, method: string,
  client?: typeof db,
): Promise<Array<'MATCHED' | 'DISCREPANCY'>> {
  if (!pairs.length) return []
  assertDisjointPairs(pairs)
  const execute = async (tx: typeof db) => {
    const ids = pairs.flatMap(pair => [...pair])
    const rows = await tx.$queryRawUnsafe(`SELECT id,"accountId",source::text,type::text,currency,
      amount::text,status::text,"matchedTxId","amountDiff"::text,"platformTxId","platformUserId","shamCashTxId","reviewCategory"::text
      FROM transactions WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`, ids) as AutoRow[]
    const byId = new Map(rows.map(row => [row.id, row]))
    if (rows.length !== ids.length) throw new AutoMatchConflict()
    // A legacy one-way inbound reference also makes a row unavailable.
    const inbound = await tx.transaction.findMany({ where: { matchedTxId: { in: ids }, id: { notIn: ids } }, select: { id: true }, take: 1 })
    if (inbound.length) throw new AutoMatchConflict()
    const changes: Array<{ id: string; before: AutoState; after: AutoState }> = []
    const statuses: Array<'MATCHED' | 'DISCREPANCY'> = []
    for (const [a, b] of pairs) {
      const left = byId.get(a)!, right = byId.get(b)!
      if (left.accountId !== right.accountId || left.type !== right.type || left.source === right.source
        || !['PLATFORM', 'SHAM_CASH'].includes(left.source) || !['PLATFORM', 'SHAM_CASH'].includes(right.source)
        || !left.currency || left.currency.trim().toUpperCase() !== right.currency?.trim().toUpperCase()
        || !['DEPOSIT', 'WITHDRAWAL'].includes(left.type) || left.reviewCategory || right.reviewCategory
        || !['PENDING_SC', 'PENDING_P', 'MATCHED', 'DISCREPANCY'].includes(left.status)
        || !['PENDING_SC', 'PENDING_P', 'MATCHED', 'DISCREPANCY'].includes(right.status)
        || (left.matchedTxId !== null && left.matchedTxId !== b) || (right.matchedTxId !== null && right.matchedTxId !== a)) throw new AutoMatchConflict()
      if (method !== 'NEW_BATCH' && [left, right].some(row => row.matchedTxId !== null
        || row.status !== (row.source === 'PLATFORM' ? 'PENDING_P' : 'PENDING_SC'))) throw new AutoMatchConflict()
      if ([left, right].some(row => row.status.startsWith('PENDING_')
        && row.status !== (row.source === 'PLATFORM' ? 'PENDING_P' : 'PENDING_SC'))) throw new AutoMatchConflict()
      const cents = (value: string) => {
        if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(value)) throw new AutoMatchConflict()
        const [whole, fraction = ''] = value.split('.')
        return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'))
      }
      const delta = cents(left.amount) - cents(right.amount)
      const diff = Number(delta < BigInt(0) ? -delta : delta) / 100
      const status = diff === 0 ? 'MATCHED' : 'DISCREPANCY'
      statuses.push(status)
      const platform = left.source === 'PLATFORM' ? left : right
      const sc = left.source === 'SHAM_CASH' ? left : right
      if (platform.shamCashTxId && sc.shamCashTxId && platform.shamCashTxId !== sc.shamCashTxId) throw new AutoMatchConflict()
      if (platform.platformTxId && sc.platformTxId && platform.platformTxId !== sc.platformTxId) throw new AutoMatchConflict()
      if (platform.platformUserId && sc.platformUserId && platform.platformUserId !== sc.platformUserId) throw new AutoMatchConflict()
      if (method === 'HISTORICAL_COMPLAINT' && (delta !== BigInt(0) || !platform.platformUserId
        || platform.platformUserId !== sc.platformUserId)) throw new AutoMatchConflict()
      for (const [row, partner] of [[left, right], [right, left]]) {
        const before = state(row)
        const after: AutoState = { status, matchedTxId: partner.id, amountDiff: diff === 0 ? null : String(diff),
          platformTxId: row.platformTxId || platform.platformTxId, platformUserId: row.platformUserId || platform.platformUserId,
          shamCashTxId: row.shamCashTxId || sc.shamCashTxId }
        changes.push({ id: row.id, before, after })
      }
    }
    // All rows remain locked until commit. One parameterized update avoids an
    // extra network round trip per row on large files.
    const updated = await tx.$executeRawUnsafe(`UPDATE transactions t SET
      status = (j->>'status')::"TransactionStatus", "matchedTxId"=j->>'matchedTxId',
      "amountDiff"=(j->>'amountDiff')::numeric, "platformTxId"=j->>'platformTxId',
      "platformUserId"=j->>'platformUserId', "shamCashTxId"=j->>'shamCashTxId'
      FROM jsonb_array_elements($1::jsonb) j WHERE t.id=j->>'id'`,
      JSON.stringify(changes.map(change => ({ id: change.id, ...change.after }))))
    if (updated !== changes.length) throw new AutoMatchConflict()
    // Bound each audit document, including large uploads. Never put rawData here.
    for (let start = 0; start < changes.length; start += 100) await tx.auditLog.create({ data: {
      userId: null, action: 'AUTO_MATCH_PAIRS', entity: 'UploadAttempt',
      entityId: getAuditMetadata().operationId || null,
      details: { ...getAuditMetadata(), actorType: 'SYSTEM', method, reason: 'automatic_reconciliation', result: 'SUCCESS', changes: changes.slice(start, start + 100) },
    } })
    return statuses
  }
  if (client) return execute(client)
  return db.$transaction(execute, { maxWait: 10000, timeout: 25000 })
}

/** Refresh the business days/customers actually changed by THIS upload, not
 * just the dates of freshly inserted files. Reads bounded journal fragments;
 * no historical repair or full account rebuild is performed. */
export async function automaticReadModelChanges(accountId: string, since: Date): Promise<ChangedTransaction[]> {
  const operationId = getAuditMetadata().operationId
  if (!operationId) return []
  return db.$queryRawUnsafe(`SELECT DISTINCT t."accountId", t."txDateTime", t."customerName", t."shamCashTxId"
    FROM audit_logs a CROSS JOIN LATERAL jsonb_array_elements(a.details->'changes') change
    JOIN transactions t ON t.id=change->>'id'
    WHERE a.action='AUTO_MATCH_PAIRS' AND a."entityId"=$1 AND a."createdAt">=$2
      AND t."accountId"=$3`, operationId, since, accountId)
}

type AutoState = { status: string; matchedTxId: string | null; amountDiff: string | null; platformTxId: string | null; platformUserId: string | null; shamCashTxId: string | null }
type AutoRow = AutoState & { id: string; accountId: string; type: string; source: string; currency: string; amount: string; reviewCategory: string | null }
function state(row: AutoRow): AutoState {
  return { status: row.status, matchedTxId: row.matchedTxId, amountDiff: row.amountDiff,
    platformTxId: row.platformTxId, platformUserId: row.platformUserId, shamCashTxId: row.shamCashTxId }
}
