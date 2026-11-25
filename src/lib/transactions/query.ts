import { z } from 'zod'
import type { Prisma } from '@prisma/client'

/**
 * Query parsing and keyset-cursor helpers shared by the lightweight
 * transaction-list endpoint. Keeping this separate makes the boundary
 * testable and prevents route handlers from accepting unbounded page sizes.
 */

export const TRANSACTION_LIST_LIMITS = [25, 50, 100] as const
export type TransactionListLimit = typeof TRANSACTION_LIST_LIMITS[number]

export const TRANSACTION_LIST_SORT_FIELDS = [
  'txDateTime',
  'createdAt',
  'updatedAt',
  'amount',
  'amountDiff', 'account', 'type', 'status', 'reviewCategory', 'customerName',
  'shamCashTxId', 'platformTxId', 'platformUserId', 'source', 'notes', 'handledByUser', 'batch', 'hasDelay',
] as const
export type TransactionListSortField = typeof TRANSACTION_LIST_SORT_FIELDS[number]
export type SortDirection = 'asc' | 'desc'

const transactionStatuses = [
  'MATCHED', 'PENDING_SC', 'PENDING_P', 'DISCREPANCY', 'WASTE', 'RETURNS',
] as const
const transactionTypes = ['DEPOSIT', 'WITHDRAWAL'] as const
const transactionSources = ['SHAM_CASH', 'PLATFORM'] as const
const reviewCategories = [
  'THEFT', 'WASTE', 'EXTRA', 'EMPLOYEE_ERROR', 'CUSTOMER_ERROR',
  'PLATFORM_ERROR', 'COMPLAINT', 'INTERNAL_TRANSFER', 'OTHER',
] as const
const listCategories = ['gross', 'waste', 'extras', 'internal'] as const

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}, 'Invalid calendar date')

const querySchema = z.object({
  limit: z.enum(['25', '50', '100']).optional().default('50'),
  cursor: z.string().min(1).max(32768).optional(),
  status: z.enum(transactionStatuses).optional(),
  type: z.enum(transactionTypes).optional(),
  source: z.enum(transactionSources).optional(),
  accountId: z.string().min(1).max(191).optional(),
  batchId: z.string().min(1).max(191).optional(),
  currency: z.string().trim().min(1).max(12).optional(),
  dateFrom: dateOnly.optional(),
  dateTo: dateOnly.optional(),
  reviewed: z.enum(['true', 'false']).optional(),
  reviewCategory: z.enum(reviewCategories).optional(),
  category: z.enum(listCategories).optional(),
  search: z.string().trim().min(1).max(160).optional(),
  duplicates: z.enum(['1', 'true']).optional(),
  hideMatched: z.enum(['1', 'true']).optional(),
  excludeWalletTransfers: z.enum(['1', 'true']).optional(),
  sortBy: z.enum(TRANSACTION_LIST_SORT_FIELDS).optional().default('txDateTime'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export interface TransactionListQuery {
  limit: TransactionListLimit
  cursor?: string
  status?: typeof transactionStatuses[number]
  type?: typeof transactionTypes[number]
  source?: typeof transactionSources[number]
  accountId?: string
  batchId?: string
  currency?: string
  dateFrom?: string
  dateTo?: string
  reviewed?: boolean
  reviewCategory?: typeof reviewCategories[number]
  category?: typeof listCategories[number]
  search?: string
  duplicates: boolean
  hideMatched: boolean
  excludeWalletTransfers: boolean
  sortBy: TransactionListSortField
  sortDir: SortDirection
}

export function parseTransactionListQuery(searchParams: URLSearchParams): TransactionListQuery {
  const values = Object.fromEntries(searchParams.entries())
  // Existing filter bars serialize empty controls. Treat those as omitted
  // rather than rejecting an otherwise valid list request.
  for (const [key, value] of Object.entries(values)) {
    if (value.trim() === '') delete values[key]
  }
  const parsed = querySchema.parse(values)

  if (parsed.dateFrom && parsed.dateTo && parsed.dateFrom > parsed.dateTo) {
    throw new z.ZodError([{ code: 'custom', path: ['dateTo'], message: 'dateTo must be on or after dateFrom' }])
  }

  return {
    ...parsed,
    limit: Number(parsed.limit) as TransactionListLimit,
    reviewed: parsed.reviewed === undefined ? undefined : parsed.reviewed === 'true',
    duplicates: Boolean(parsed.duplicates),
    hideMatched: Boolean(parsed.hideMatched),
    excludeWalletTransfers: Boolean(parsed.excludeWalletTransfers),
  }
}

export interface TransactionCursor {
  id: string
  value: string | null
  sortBy: TransactionListSortField
  sortDir: SortDirection
}

export class InvalidTransactionCursorError extends Error {
  constructor() {
    super('Invalid transaction cursor')
  }
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

export function encodeTransactionCursor(cursor: TransactionCursor): string {
  return base64UrlEncode(JSON.stringify(cursor))
}

export function decodeTransactionCursor(
  value: string,
  expected: Pick<TransactionCursor, 'sortBy' | 'sortDir'>,
): TransactionCursor {
  try {
    const parsed = JSON.parse(base64UrlDecode(value)) as Partial<TransactionCursor>
    if (
      !parsed ||
      typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 191 ||
      (typeof parsed.value !== 'string' && parsed.value !== null) ||
      !TRANSACTION_LIST_SORT_FIELDS.includes(parsed.sortBy as TransactionListSortField) ||
      (parsed.sortDir !== 'asc' && parsed.sortDir !== 'desc') ||
      parsed.sortBy !== expected.sortBy ||
      parsed.sortDir !== expected.sortDir
    ) {
      throw new InvalidTransactionCursorError()
    }
    validateCursorValue(parsed as TransactionCursor)
    return parsed as TransactionCursor
  } catch {
    throw new InvalidTransactionCursorError()
  }
}

export function cursorValueForTransaction(
  transaction: Record<string, unknown>,
  sortBy: TransactionListSortField,
): string | null {
  const relation = relationSorts[sortBy]
  const value = effectiveTransactionSortFields.has(sortBy)
    ? transaction[sortBy] || (transaction.matchedTx as Record<string, unknown> | null)?.[sortBy] || null
    : relation ? (transaction[relation[0]] as Record<string, unknown> | null)?.[relation[1]] : transaction[sortBy]
  if (value == null && nullableSorts.has(sortBy)) return null
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object' && 'toString' in value) return String(value)
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  throw new InvalidTransactionCursorError()
}

/**
 * Builds the stable `(sort value, id)` portion of a keyset query.  Only
 * validated column names are accepted. Enum comparisons use explicit order
 * buckets, nullable scalars sort last, and optional relations match PostgreSQL
 * ordering. Display identifiers that coalesce a linked row use the SQL path.
 */
export function buildTransactionKeysetClause(
  cursor: TransactionCursor,
): Record<string, unknown> {
  validateCursorValue(cursor)
  const direction = cursor.sortDir === 'asc' ? 'gt' : 'lt'
  const relation = relationSorts[cursor.sortBy]
  const field = (value: unknown) => relation
    ? { [relation[0]]: value === null ? null : { [relation[1]]: value } } : { [cursor.sortBy]: value }
  const nullsFirst = relation && nullableSorts.has(cursor.sortBy) && cursor.sortDir === 'desc'
  if (cursor.value === null) return { OR: [
    { AND: [field(null), { id: { [direction]: cursor.id } }] },
    ...(nullsFirst ? [{ [relation[0]]: { isNot: null } }] : []),
  ] }
  const value = dateSorts.has(cursor.sortBy) ? new Date(cursor.value) : cursor.value
  const enumValues = enumSorts[cursor.sortBy]
  const booleanComparison = cursor.sortBy === 'hasDelay'
    ? (cursor.sortDir === 'asc' && cursor.value === 'false' ? { hasDelay: true }
      : cursor.sortDir === 'desc' && cursor.value === 'true' ? { hasDelay: false } : null) : undefined
  const comparison = enumValues ? { in: enumValues.filter((_, index) => cursor.sortDir === 'asc'
    ? index > enumValues.indexOf(cursor.value!) : index < enumValues.indexOf(cursor.value!)) } : { [direction]: value }
  return {
    OR: [
      ...(booleanComparison === undefined ? [field(comparison)] : booleanComparison ? [booleanComparison] : []),
      { ...field(cursor.sortBy === 'hasDelay' ? cursor.value === 'true' : value), id: { [direction]: cursor.id } },
      ...(nullableSorts.has(cursor.sortBy) && !nullsFirst ? [field(null)] : []),
    ],
  }
}

export const relationSorts: Partial<Record<TransactionListSortField, [string, string]>> = {
  account: ['account', 'name'], handledByUser: ['handledByUser', 'name'], batch: ['batch', 'createdAt'],
}
export const effectiveTransactionSortFields = new Set<TransactionListSortField>(['customerName', 'shamCashTxId', 'platformTxId', 'platformUserId'])
export const nullableSorts = new Set<TransactionListSortField>([
  'amountDiff', 'reviewCategory', 'customerName', 'shamCashTxId', 'platformTxId', 'platformUserId', 'notes', 'handledByUser',
])
export const dateSorts = new Set<TransactionListSortField>(['txDateTime', 'createdAt', 'updatedAt', 'batch'])
export const enumSorts: Partial<Record<TransactionListSortField, readonly string[]>> = {
  status: transactionStatuses, type: transactionTypes, source: transactionSources, reviewCategory: reviewCategories,
}
function validateCursorValue(cursor: TransactionCursor) {
  if (cursor.value === null) {
    if (!nullableSorts.has(cursor.sortBy)) throw new InvalidTransactionCursorError()
  } else if (typeof cursor.value !== 'string'
    || (dateSorts.has(cursor.sortBy) && !Number.isFinite(Date.parse(cursor.value)))
    || (['amount', 'amountDiff'].includes(cursor.sortBy) && !/^-?\d{1,13}(?:\.\d{1,2})?$/.test(cursor.value))
    || (enumSorts[cursor.sortBy] && !enumSorts[cursor.sortBy]!.includes(cursor.value))) throw new InvalidTransactionCursorError()
  if (cursor.sortBy === 'hasDelay' && !['true', 'false'].includes(cursor.value!)) throw new InvalidTransactionCursorError()
}

export function transactionListOrderBy(query: Pick<TransactionListQuery, 'sortBy' | 'sortDir'>): Prisma.TransactionOrderByWithRelationInput[] {
  const relation = relationSorts[query.sortBy]
  const primary = relation ? { [relation[0]]: { [relation[1]]: query.sortDir } }
    : { [query.sortBy]: nullableSorts.has(query.sortBy) ? { sort: query.sortDir, nulls: 'last' } : query.sortDir }
  return [primary, { id: query.sortDir }] as Prisma.TransactionOrderByWithRelationInput[]
}

export const transactionListValues = {
  statuses: transactionStatuses,
  types: transactionTypes,
  sources: transactionSources,
  reviewCategories,
} as const
