import { db } from '@/lib/db/client'
import {
  decodeTransactionCursor,
  dateSorts,
  nullableSorts,
  relationSorts,
  type TransactionListQuery,
  type TransactionListSortField,
  effectiveTransactionSortFields,
} from '@/lib/transactions/query'
import { addDays, damascusDayStartUtc } from '@/lib/datetime'

/**
 * The duplicate read model has one row per `(accountId, shamCashTxId)`.
 *
 * Keeping the duplicate predicate inside PostgreSQL is important: expanding
 * every group into a Prisma `OR` clause used to materialize all duplicate
 * ShamCash numbers in Node before the list query could start.  On a large
 * account that turns a 100-row page into a multi-megabyte request and an
 * unbounded SQL statement.  This helper only returns at most `limit + 1`
 * transaction ids; the route then loads its normal lightweight projection.
 */
export interface DuplicateTransactionPage {
  total: number
  ids: string[]
  /** True number reuse only; currency anomalies must not get a duplicate badge. */
  duplicateIds: string[]
}

type CountRow = { total: number | bigint | string }
type IdRow = { id: string; hasDuplicateSc: boolean }

const sortColumns: Record<TransactionListSortField, string> = {
  txDateTime: 't."txDateTime"',
  createdAt: 't."createdAt"',
  updatedAt: 't."updatedAt"',
  amount: 't.amount',
  amountDiff: 't."amountDiff"', account: '(SELECT a.name FROM accounts a WHERE a.id = t."accountId")',
  handledByUser: '(SELECT u.name FROM users u WHERE u.id = t."handledByUserId")',
  batch: '(SELECT b."createdAt" FROM upload_batches b WHERE b.id = t."batchId")',
  type: 't.type', status: 't.status', reviewCategory: 't."reviewCategory"', customerName: 't."customerName"',
  shamCashTxId: 't."shamCashTxId"', platformTxId: 't."platformTxId"', platformUserId: 't."platformUserId"',
  source: 't.source', notes: 't.notes', hasDelay: 't."hasDelay"',
}
for (const key of effectiveTransactionSortFields) {
  sortColumns[key] = `COALESCE(NULLIF(t."${key}", ''), (SELECT NULLIF(mt."${key}", '') FROM transactions mt WHERE mt.id = t."matchedTxId"))`
}

function numeric(value: number | bigint | string | undefined): number {
  const result = Number(value ?? 0)
  return Number.isFinite(result) ? result : 0
}

/**
 * Produces a fully parameterized predicate for the duplicate-list SQL.  The
 * only interpolated tokens are a fixed column map and `ASC` / `DESC` values
 * that originate from the Zod enum in `parseTransactionListQuery`.
 */
function buildDuplicatePredicate(
  query: TransactionListQuery,
  accountIds?: string[],
): { whereSql: string; values: unknown[] } {
  const values: unknown[] = []
  const bind = (value: unknown, cast = ''): string => {
    values.push(value)
    return `$${values.length}${cast}`
  }
  const clauses: string[] = query.duplicates ? [
    '(d."pairCount" > 1 OR d."hasCurrencyMismatch" = TRUE)',
    't."shamCashTxId" IS NOT NULL',
  ] : []
  if (!query.duplicates && !query.source && !query.batchId && !query.search) clauses.push(`NOT (t.status = 'MATCHED' AND t.source = 'PLATFORM')`)

  if (accountIds) {
    // An empty account-manager scope is short-circuited by the caller.  This
    // remains parameterized for a non-empty scope and never trusts an id in a
    // SQL string.
    clauses.push(`t."accountId" = ANY(${bind(accountIds, '::text[]')})`)
  }
  if (query.status) clauses.push(`t.status = ${bind(query.status)}`)
  if (query.type) clauses.push(`t.type = ${bind(query.type)}`)
  if (query.source) clauses.push(`t.source = ${bind(query.source)}`)
  if (query.batchId) clauses.push(`t."batchId" = ${bind(query.batchId)}`)
  if (query.currency) clauses.push(`t.currency = ${bind(query.currency)}`)

  if (query.reviewed === true) clauses.push('t."reviewCategory" IS NOT NULL')
  if (query.reviewed === false) clauses.push('t."reviewCategory" IS NULL')
  if (query.reviewCategory) clauses.push(`t."reviewCategory" = ${bind(query.reviewCategory)}`)

  if (query.category === 'waste') {
    clauses.push(`(t.status = 'WASTE' OR t."reviewCategory" = 'WASTE')`)
  } else if (query.category === 'extras') {
    clauses.push(`t."reviewCategory" = 'EXTRA'`)
  } else if (query.category === 'internal') {
    clauses.push(`(t."reviewCategory" = 'INTERNAL_TRANSFER' OR t."isInternalTransferAuto" = TRUE)`)
  }

  if (query.dateFrom) {
    clauses.push(`t."txDateTime" >= ${bind(damascusDayStartUtc(query.dateFrom), '::timestamp')}`)
  }
  if (query.dateTo) {
    clauses.push(`t."txDateTime" < ${bind(damascusDayStartUtc(addDays(query.dateTo, 1)), '::timestamp')}`)
  }

  if (query.search) {
    const pattern = bind(`%${query.search}%`)
    clauses.push(`(
      t."shamCashTxId" ILIKE ${pattern}
      OR t."platformTxId" ILIKE ${pattern}
      OR t."platformUserId" ILIKE ${pattern}
    )`)
  }

  if (query.hideMatched) {
    clauses.push(`(t.status <> 'MATCHED' OR t."reviewCategory" = 'INTERNAL_TRANSFER')`)
  }

  if (query.excludeWalletTransfers) {
    // Keep manually reviewed internal transfers visible. This mirrors the
    // normal Prisma list path and avoids accidentally hiding audit records.
    clauses.push(`(
      t.status <> 'PENDING_SC'
      OR t."isInternalTransferAuto" = FALSE
      OR t."reviewCategory" = 'INTERNAL_TRANSFER'
    )`)
  }

  if (query.cursor) {
    const cursor = decodeTransactionCursor(query.cursor, query)
    const column = sortColumns[query.sortBy]
    const operator = query.sortDir === 'asc' ? '>' : '<'
    const cursorId = bind(cursor.id)
    const nullsFirst = Boolean(relationSorts[query.sortBy] && nullableSorts.has(query.sortBy) && query.sortDir === 'desc')
    if (cursor.value === null) {
      clauses.push(`((${column} IS NULL AND t.id ${operator} ${cursorId})${nullsFirst ? ` OR ${column} IS NOT NULL` : ''})`)
    } else {
      const enumCast: Record<string, string> = { type: '::"TransactionType"', status: '::"TransactionStatus"', source: '::"TransactionSource"', reviewCategory: '::"ReviewCategory"' }
      const cursorValue = dateSorts.has(query.sortBy) ? bind(new Date(cursor.value), '::timestamp')
        : bind(cursor.value, query.sortBy === 'hasDelay' ? '::boolean' : ['amount', 'amountDiff'].includes(query.sortBy) ? '::numeric' : enumCast[query.sortBy] || '')
      clauses.push(`(${column} ${operator} ${cursorValue} OR (${column} = ${cursorValue} AND t.id ${operator} ${cursorId})${nullableSorts.has(query.sortBy) && !nullsFirst ? ` OR ${column} IS NULL` : ''})`)
    }
  }

  return { whereSql: clauses.join('\n  AND ') || 'TRUE', values }
}

export async function fetchDuplicateTransactionPage(
  query: TransactionListQuery,
  accountIds?: string[],
): Promise<DuplicateTransactionPage> {
  if (accountIds?.length === 0) return { total: 0, ids: [], duplicateIds: [] }

  const { whereSql, values } = buildDuplicatePredicate(query, accountIds)
  const count = query.cursor ? buildDuplicatePredicate({ ...query, cursor: undefined }, accountIds) : { whereSql, values }
  const column = sortColumns[query.sortBy]
  const direction = query.sortDir === 'asc' ? 'ASC' : 'DESC'
  // Add one query-local binding for the bounded keyset window.  The count
  // query deliberately receives only predicate bindings.
  const pageValues = [...values, query.limit + 1]
  const limitPlaceholder = `$${pageValues.length}`
  const fromSql = `
    FROM "transactions" t
    ${query.duplicates ? `INNER JOIN "duplicate_sc_groups" d
      ON d."accountId" = t."accountId"
      AND d."shamCashTxId" = t."shamCashTxId"` : ''}
    WHERE ${whereSql}
  `

  const [countRows, idRows] = await Promise.all([
    db.$queryRawUnsafe(`SELECT count(*) AS total ${fromSql.replace(`WHERE ${whereSql}`, `WHERE ${count.whereSql}`)}`, ...count.values) as Promise<CountRow[]>,
    db.$queryRawUnsafe(`
      SELECT t.id, ${query.duplicates ? '(d."pairCount" > 1)' : 'FALSE'} AS "hasDuplicateSc" ${fromSql}
      ORDER BY ${column} ${direction} NULLS ${relationSorts[query.sortBy] && nullableSorts.has(query.sortBy) && query.sortDir === 'desc' ? 'FIRST' : 'LAST'}, t.id ${direction}
      LIMIT ${limitPlaceholder}
    `, ...pageValues) as Promise<IdRow[]>,
  ])

  return {
    total: numeric(countRows[0]?.total),
    ids: idRows.map(row => row.id),
    duplicateIds: idRows.filter(row => row.hasDuplicateSc).map(row => row.id),
  }
}
