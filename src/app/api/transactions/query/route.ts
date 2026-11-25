import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import {
  buildTransactionKeysetClause,
  cursorValueForTransaction,
  decodeTransactionCursor,
  encodeTransactionCursor,
  InvalidTransactionCursorError,
  parseTransactionListQuery,
  transactionListOrderBy,
  effectiveTransactionSortFields,
  type TransactionListQuery,
} from '@/lib/transactions/query'
import { estimateJsonBytes, requestMetricsHeaders } from '@/lib/performance/cache'
import { fetchDuplicateTransactionPage } from '@/lib/transactions/duplicatePage'
import { hasLinkedCurrencyMismatch } from '@/lib/reconciliation/duplicateReview'
import { addDays, damascusDayStartUtc } from '@/lib/datetime'
import { z } from 'zod'

export const runtime = 'nodejs'

const LIST_HEADERS = { 'Cache-Control': 'private, no-store' }

type TransactionListRecord = {
  id: string
  accountId: string
  batchId: string
  source: string
  type: string
  shamCashTxId: string | null
  platformTxId: string | null
  platformUserId: string | null
  amount: unknown
  currency: string
  txDateTime: Date | string
  status: string
  matchedTxId: string | null
  amountDiff: unknown | null
  customerName: string | null
  isInternalTransferAuto: boolean
  notes: string | null
  reviewCategory: string | null
  reviewNotes: string | null
  reviewedBy: string | null
  reviewedAt: Date | string | null
  followUpStatus: string | null
  handledByUserId: string | null
  handlerAmbiguous: boolean
  createdAt: Date | string
  updatedAt: Date | string
  account: { id: string; name: string; currency: string }
  matchedTx: {
    id: string
    shamCashTxId: string | null
    platformTxId: string | null
    platformUserId: string | null
    customerName: string | null
    isInternalTransferAuto: boolean
    amount: unknown
    currency: string
    source: string
    txDateTime: Date | string
  } | null
  handledByUser: { id: string; name: string } | null
  batch: {
    id: string
    batchDate: Date | string
    createdAt: Date | string
    uploader: { name: string } | null
  } | null
}

export interface TransactionListItem {
  id: string
  accountId: string
  batchId: string
  source: string
  type: string
  shamCashTxId: string | null
  platformTxId: string | null
  platformUserId: string | null
  amount: number
  currency: string
  txDateTime: string
  status: string
  matchedTxId: string | null
  amountDiff: number | null
  notes: string | null
  /** A normalized display value; it deliberately never exposes rawData. */
  displayNotes: string | null
  customerName: string | null
  isInternalTransferAuto: boolean
  reviewCategory: string | null
  reviewNotes: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  followUpStatus: string | null
  handledByUserId: string | null
  handlerAmbiguous: boolean
  createdAt: string
  updatedAt: string
  account: { id: string; name: string; currency: string }
  matchedTx: {
    id: string
    shamCashTxId: string | null
    platformTxId: string | null
    platformUserId: string | null
    customerName: string | null
    isInternalTransferAuto: boolean
    amount: number
    currency: string
    source: string
    txDateTime: string
  } | null
  handledByUser: { id: string; name: string } | null
  batch: {
    id: string
    batchDate: string | null
    createdAt: string | null
    uploaderName: string | null
  } | null
  hasDuplicateSc: boolean
  hasCurrencyMismatch: boolean
}

const transactionListSelect = {
  id: true,
  accountId: true,
  batchId: true,
  source: true,
  type: true,
  shamCashTxId: true,
  platformTxId: true,
  platformUserId: true,
  amount: true,
  currency: true,
  txDateTime: true,
  status: true,
  matchedTxId: true,
  amountDiff: true,
  hasDelay: true,
  customerName: true,
  isInternalTransferAuto: true,
  notes: true,
  reviewCategory: true,
  reviewNotes: true,
  reviewedBy: true,
  reviewedAt: true,
  followUpStatus: true,
  handledByUserId: true,
  handlerAmbiguous: true,
  createdAt: true,
  updatedAt: true,
  account: { select: { id: true, name: true, currency: true } },
  matchedTx: {
    select: {
      id: true,
      shamCashTxId: true,
      platformTxId: true,
      platformUserId: true,
      customerName: true,
      isInternalTransferAuto: true,
      amount: true,
      currency: true,
      source: true,
      txDateTime: true,
    },
  },
  handledByUser: { select: { id: true, name: true } },
  batch: {
    select: {
      id: true,
      batchDate: true,
      createdAt: true,
      uploader: { select: { name: true } },
    },
  },
} as const

function toIso(value: Date | string | null): string | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toNumber(value: unknown): number {
  return Number(value)
}

interface ResolvedAccountScope {
  where?: unknown
  /** Explicit ids used by duplicate helpers, so hints cannot cross scope. */
  accountIds?: string[]
}

async function accountScope(
  userId: string,
  role: string,
  requestedAccountId?: string,
): Promise<ResolvedAccountScope> {
  if (role !== UserRole.ACCOUNT_MGR) {
    return requestedAccountId
      ? { where: requestedAccountId, accountIds: [requestedAccountId] }
      : {}
  }

  const access = await db.accountAccess.findMany({
    where: { userId },
    select: { accountId: true },
  }) as Array<{ accountId: string }>
  const allowedIds = access.map(row => row.accountId)

  if (requestedAccountId) {
    return allowedIds.includes(requestedAccountId)
      ? { where: requestedAccountId, accountIds: [requestedAccountId] }
      : { where: { in: [] }, accountIds: [] }
  }
  return { where: { in: allowedIds }, accountIds: allowedIds }
}

function appendFilter(clauses: Record<string, unknown>[], filter: Record<string, unknown> | undefined) {
  if (filter && Object.keys(filter).length > 0) clauses.push(filter)
}

function buildWhere(
  query: TransactionListQuery,
  scopedAccountId: unknown,
): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = []
  if (scopedAccountId !== undefined) appendFilter(clauses, { accountId: scopedAccountId })
  if (query.status) appendFilter(clauses, { status: query.status })
  if (query.type) appendFilter(clauses, { type: query.type })
  if (query.source) appendFilter(clauses, { source: query.source })
  if (query.batchId) appendFilter(clauses, { batchId: query.batchId })
  if (query.currency) appendFilter(clauses, { currency: query.currency })

  if (query.reviewed === true) appendFilter(clauses, { reviewCategory: { not: null } })
  if (query.reviewed === false) appendFilter(clauses, { reviewCategory: null })
  if (query.reviewCategory) appendFilter(clauses, { reviewCategory: query.reviewCategory })

  if (query.category === 'waste') {
    appendFilter(clauses, { OR: [{ status: 'WASTE' }, { reviewCategory: 'WASTE' }] })
  } else if (query.category === 'extras') {
    appendFilter(clauses, { reviewCategory: 'EXTRA' })
  } else if (query.category === 'internal') {
    appendFilter(clauses, {
      OR: [{ reviewCategory: 'INTERNAL_TRANSFER' }, { isInternalTransferAuto: true }],
    })
  }

  if (query.dateFrom || query.dateTo) {
    appendFilter(clauses, {
      txDateTime: {
        // Pickers represent the Damascus business calendar. A half-open
        // interval also matches FinancialDailySummary exactly at UTC edges.
        ...(query.dateFrom ? { gte: damascusDayStartUtc(query.dateFrom) } : {}),
        ...(query.dateTo ? { lt: damascusDayStartUtc(addDays(query.dateTo, 1)) } : {}),
      },
    })
  }

  if (query.search) {
    appendFilter(clauses, {
      OR: [
        { shamCashTxId: { contains: query.search, mode: 'insensitive' } },
        { platformTxId: { contains: query.search, mode: 'insensitive' } },
        { platformUserId: { contains: query.search, mode: 'insensitive' } },
      ],
    })
  }

  // Legacy reconciliation normally shows one side of a matched pair. Keep
  // that behavior in the new endpoint unless a source, batch, search, or the
  // duplicate drill-down explicitly asks to see both sides.
  if (!query.source && !query.batchId && !query.search && !query.duplicates) {
    appendFilter(clauses, {
      NOT: { AND: [{ status: 'MATCHED' }, { source: 'PLATFORM' }] },
    })
  }

  if (query.hideMatched) {
    appendFilter(clauses, {
      OR: [
        { status: { not: 'MATCHED' } },
        { reviewCategory: 'INTERNAL_TRANSFER' },
      ],
    })
  }

  if (query.excludeWalletTransfers) {
    // Match the legacy reconciliation behavior: hide only automatically
    // classified PENDING_SC wallet transfers. A manually reviewed internal
    // transfer remains visible as an audit record, and other statuses are not
    // silently removed by this queue-specific preference.
    appendFilter(clauses, {
      OR: [
        { status: { not: 'PENDING_SC' } },
        { isInternalTransferAuto: false },
        { reviewCategory: 'INTERNAL_TRANSFER' },
      ],
    })
  }

  if (query.cursor) {
    const cursor = decodeTransactionCursor(query.cursor, query)
    appendFilter(clauses, buildTransactionKeysetClause(cursor))
  }

  if (clauses.length === 0) return {}
  if (clauses.length === 1) return clauses[0]
  return { AND: clauses }
}

async function countDuplicateGroups(accountIds?: string[]): Promise<number> {
  if (accountIds?.length === 0) return 0
  return db.duplicateScGroup.count({
    where: {
      OR: [{ pairCount: { gt: 1 } }, { hasCurrencyMismatch: true }],
      ...(accountIds ? { accountId: { in: accountIds } } : {}),
    },
  }) as Promise<number>
}

async function findPageDuplicateGroups(rows: TransactionListRecord[]): Promise<Set<string>> {
  const pairs = Array.from(new Map(
    rows
      .filter((row): row is TransactionListRecord & { shamCashTxId: string } => Boolean(row.shamCashTxId))
      .map(row => [`${row.accountId}\u0000${row.shamCashTxId}`, {
        accountId: row.accountId,
        shamCashTxId: row.shamCashTxId,
      }]),
  ).values())
  if (pairs.length === 0) return new Set()

  const groups = await db.duplicateScGroup.findMany({
    where: {
      pairCount: { gt: 1 },
      OR: pairs,
    },
    select: { accountId: true, shamCashTxId: true },
  }) as Array<{ accountId: string; shamCashTxId: string }>
  return new Set(groups.map(group => `${group.accountId}\u0000${group.shamCashTxId}`))
}

function toListItem(
  row: TransactionListRecord,
  duplicateGroupKeys: Set<string>,
): TransactionListItem {
  const customerName = row.customerName ?? row.matchedTx?.customerName ?? null
  const isInternalTransferAuto = row.isInternalTransferAuto || row.matchedTx?.isInternalTransferAuto || false

  return {
    id: row.id,
    accountId: row.accountId,
    batchId: row.batchId,
    source: row.source,
    type: row.type,
    shamCashTxId: row.shamCashTxId,
    platformTxId: row.platformTxId,
    platformUserId: row.platformUserId,
    amount: toNumber(row.amount),
    currency: row.currency,
    txDateTime: toIso(row.txDateTime) ?? '',
    status: row.status,
    matchedTxId: row.matchedTxId,
    amountDiff: row.amountDiff == null ? null : toNumber(row.amountDiff),
    notes: row.notes,
    displayNotes: row.notes,
    customerName,
    isInternalTransferAuto,
    reviewCategory: row.reviewCategory,
    reviewNotes: row.reviewNotes,
    reviewedBy: row.reviewedBy,
    reviewedAt: toIso(row.reviewedAt),
    followUpStatus: row.followUpStatus,
    handledByUserId: row.handledByUserId,
    handlerAmbiguous: row.handlerAmbiguous,
    createdAt: toIso(row.createdAt) ?? '',
    updatedAt: toIso(row.updatedAt) ?? '',
    account: row.account,
    matchedTx: row.matchedTx ? {
      id: row.matchedTx.id,
      shamCashTxId: row.matchedTx.shamCashTxId,
      platformTxId: row.matchedTx.platformTxId,
      platformUserId: row.matchedTx.platformUserId,
      customerName: row.matchedTx.customerName,
      isInternalTransferAuto: row.matchedTx.isInternalTransferAuto,
      amount: toNumber(row.matchedTx.amount),
      currency: row.matchedTx.currency,
      source: row.matchedTx.source,
      txDateTime: toIso(row.matchedTx.txDateTime) ?? '',
    } : null,
    handledByUser: row.handledByUser,
    batch: row.batch ? {
      id: row.batch.id,
      batchDate: toIso(row.batch.batchDate),
      createdAt: toIso(row.batch.createdAt),
      uploaderName: row.batch.uploader?.name ?? null,
    } : null,
    hasDuplicateSc: Boolean(
      row.shamCashTxId && duplicateGroupKeys.has(`${row.accountId}\u0000${row.shamCashTxId}`),
    ),
    hasCurrencyMismatch: hasLinkedCurrencyMismatch(row),
  }
}

export async function GET(req: NextRequest) {
  const startedAt = performance.now()
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401, headers: LIST_HEADERS })
    if (session.role === UserRole.EMPLOYEE) {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403, headers: LIST_HEADERS })
    }

    const query = parseTransactionListQuery(new URL(req.url).searchParams)
    const dbStartedAt = performance.now()
    const scope = await accountScope(session.userId, session.role, query.accountId)
    const duplicateScCountPromise = countDuplicateGroups(scope.accountIds)
    let total: number
    let requestedRows: TransactionListRecord[]
    let pageDuplicateIds: Set<string>
    let duplicateScCount: number

    if (query.duplicates || effectiveTransactionSortFields.has(query.sortBy)) {
      // The old path first fetched *every* duplicate ShamCash group into Node,
      // then generated a massive `OR` clause.  The read-model join below is
      // keyset-bounded in PostgreSQL and returns at most 101 transaction ids.
      const [duplicatePage, duplicateGroupCount] = await Promise.all([
        fetchDuplicateTransactionPage(query, scope.accountIds),
        duplicateScCountPromise,
      ])
      duplicateScCount = duplicateGroupCount
      total = duplicatePage.total
      requestedRows = duplicatePage.ids.length === 0
        ? []
        : await db.transaction.findMany({
          where: { id: { in: duplicatePage.ids } },
          select: transactionListSelect,
        }) as TransactionListRecord[]

      // Prisma's `IN` query does not preserve the SQL keyset order.  Ordering
      // <= 101 light records in memory is bounded and keeps cursors stable.
      const rowById = new Map(requestedRows.map(row => [row.id, row]))
      requestedRows = duplicatePage.ids
        .map(id => rowById.get(id))
        .filter((row): row is TransactionListRecord => Boolean(row))
      pageDuplicateIds = new Set(
        requestedRows
          .filter((row): row is TransactionListRecord & { shamCashTxId: string } =>
            Boolean(row.shamCashTxId) && duplicatePage.duplicateIds.includes(row.id))
          .map(row => `${row.accountId}\u0000${row.shamCashTxId}`),
      )
    } else {
      const where = buildWhere(query, scope.where)
      const countWhere = query.cursor ? buildWhere({ ...query, cursor: undefined }, scope.where) : where
      const orderBy = transactionListOrderBy(query)
      const [normalTotal, normalRows] = await Promise.all([
        db.transaction.count({ where: countWhere }),
        db.transaction.findMany({
          where,
          select: transactionListSelect,
          orderBy,
          take: query.limit + 1,
        }),
      ]) as [number, TransactionListRecord[]]
      total = normalTotal
      requestedRows = normalRows
      pageDuplicateIds = new Set()
      duplicateScCount = await duplicateScCountPromise
    }

    const hasNext = requestedRows.length > query.limit
    const rows = requestedRows.slice(0, query.limit)
    if (!query.duplicates) pageDuplicateIds = await findPageDuplicateGroups(rows)
    const last = rows.at(-1)
    const nextCursor = hasNext && last
      ? encodeTransactionCursor({
        id: last.id,
        value: cursorValueForTransaction(last as unknown as Record<string, unknown>, query.sortBy),
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      })
      : null

    const payload = {
      success: true,
      data: rows.map(row => toListItem(row, pageDuplicateIds)),
      pageInfo: { limit: query.limit, nextCursor, hasNext, total },
      duplicateScCount,
      // Includes distinct numbers with duplicate pairs OR a currency mismatch.
      reviewGroupCount: duplicateScCount,
      generatedAt: new Date().toISOString(),
    }
    return NextResponse.json(payload, {
      headers: requestMetricsHeaders(startedAt, {
        // Queue count + page count + bounded rows + page flags; scoping adds
        // one small query for ACCOUNT_MGR users.
        dbMs: performance.now() - dbStartedAt,
        queryCount: (effectiveTransactionSortFields.has(query.sortBy) && !query.duplicates ? 5 : 4) + (session.role === UserRole.ACCOUNT_MGR ? 1 : 0),
        rowCount: rows.length,
        responseBytes: estimateJsonBytes(payload),
      }),
    })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof InvalidTransactionCursorError) {
      return NextResponse.json({ error: error.message || 'معاملات طلب غير صالحة' }, { status: 400, headers: LIST_HEADERS })
    }
    return NextResponse.json({ error: String(error) }, { status: 500, headers: LIST_HEADERS })
  }
}
