import type { Prisma } from '@prisma/client'

export const CUSTOMER_TX_SORT_KEYS = [
  'txDateTime', 'accountLabel', 'type', 'status', 'amount', 'amountDiff',
  'shamCashTxId', 'platformTxId', 'platformUserId', 'notes',
] as const
export type CustomerTxSortKey = typeof CUSTOMER_TX_SORT_KEYS[number]
export type CustomerTxSort = { key: CustomerTxSortKey; direction: 'asc' | 'desc' }
type Cursor = { id: string; value: string | null }
const nullable = new Set<CustomerTxSortKey>(['amountDiff', 'shamCashTxId', 'platformTxId', 'platformUserId', 'notes'])
export class CustomerQueryError extends Error {}

export function parseCustomerSort(params: URLSearchParams): CustomerTxSort {
  const key = params.get('sortBy') || 'txDateTime'
  const direction = params.get('sortDir') || 'desc'
  if (!CUSTOMER_TX_SORT_KEYS.includes(key as CustomerTxSortKey) || !['asc', 'desc'].includes(direction)) {
    throw new CustomerQueryError('ترتيب غير صالح')
  }
  return { key: key as CustomerTxSortKey, direction: direction as 'asc' | 'desc' }
}

function validateValue(value: unknown, sort: CustomerTxSort): value is string | null {
  if (value === null) return nullable.has(sort.key)
  if (typeof value !== 'string') return false
  if (sort.key === 'txDateTime') return Number.isFinite(new Date(value).getTime())
  if (sort.key === 'amount' || sort.key === 'amountDiff') return /^-?\d{1,13}(?:\.\d{1,2})?$/.test(value)
  if (sort.key === 'type') return ['DEPOSIT', 'WITHDRAWAL'].includes(value)
  if (sort.key === 'status') return ['MATCHED', 'PENDING_SC', 'PENDING_P', 'DISCREPANCY', 'WASTE', 'RETURNS'].includes(value)
  return true
}

export function decodeCustomerCursor(token: string | null, sort: CustomerTxSort, scope: string): Cursor | null {
  if (!token) return null
  try {
    if (token.length > 32_768) throw new Error()
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))
    // One-release compatibility for already-open tabs using the old date cursor.
    if (parsed.txDateTime && parsed.version === undefined && sort.key === 'txDateTime' && sort.direction === 'desc') {
      parsed.value = parsed.txDateTime
    } else if (parsed.version !== 2 || parsed.sortBy !== sort.key || parsed.sortDir !== sort.direction || parsed.scope !== scope) {
      throw new Error()
    }
    if (typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 191 || !validateValue(parsed.value, sort)) throw new Error()
    return { id: parsed.id, value: parsed.value }
  } catch { throw new CustomerQueryError('مؤشر الصفحة غير صالح لهذا الترتيب أو الفلتر') }
}

export function encodeCustomerCursor(row: Record<string, unknown>, sort: CustomerTxSort, scope: string): string {
  const raw = sort.key === 'accountLabel' ? (row.account as { name: string }).name : row[sort.key]
  const value = raw == null ? null : raw instanceof Date ? raw.toISOString() : String(raw)
  if (!validateValue(value, sort)) throw new CustomerQueryError('قيمة الترتيب غير صالحة')
  return Buffer.from(JSON.stringify({ version: 2, id: row.id, value, sortBy: sort.key, sortDir: sort.direction, scope })).toString('base64url')
}

export function customerOrderBy(sort: CustomerTxSort): Prisma.TransactionOrderByWithRelationInput[] {
  const primary = sort.key === 'accountLabel' ? { account: { name: sort.direction } }
    : { [sort.key]: nullable.has(sort.key) ? { sort: sort.direction, nulls: 'last' } : sort.direction }
  return [primary, { id: sort.direction }] as Prisma.TransactionOrderByWithRelationInput[]
}

export function customerCursorWhere(cursor: Cursor | null, sort: CustomerTxSort): Prisma.TransactionWhereInput {
  if (!cursor) return {}
  const op = sort.direction === 'asc' ? 'gt' : 'lt'
  const field = (value: unknown): Prisma.TransactionWhereInput => (
    sort.key === 'accountLabel' ? { account: { name: value } } : { [sort.key]: value }
  ) as Prisma.TransactionWhereInput
  if (cursor.value === null) return { AND: [field(null), { id: { [op]: cursor.id } }] }
  const value = sort.key === 'txDateTime' ? new Date(cursor.value) : cursor.value
  const enumValues = sort.key === 'type' ? ['DEPOSIT', 'WITHDRAWAL']
    : sort.key === 'status' ? ['MATCHED', 'PENDING_SC', 'PENDING_P', 'DISCREPANCY', 'WASTE', 'RETURNS'] : null
  const orderedComparison = enumValues
    ? field({ in: enumValues.filter((_, index) => sort.direction === 'asc'
      ? index > enumValues.indexOf(cursor.value!) : index < enumValues.indexOf(cursor.value!)) })
    : field({ [op]: value })
  return { OR: [
    orderedComparison,
    { AND: [field(value), { id: { [op]: cursor.id } }] },
    ...(nullable.has(sort.key) ? [field(null)] : []),
  ] } as Prisma.TransactionWhereInput
}

export function customerSearchWhere(search: string): Prisma.TransactionWhereInput {
  const terms = search.split(/[,،|\n]+|\s+أو\s+/).map(term => term.trim()).filter(Boolean).slice(0, 10)
  if (!terms.length) return {}
  return { OR: terms.map(term => ({ OR: [
    ...['shamCashTxId', 'platformTxId', 'platformUserId', 'notes', 'reviewNotes', 'currency']
      .map(key => ({ [key]: { contains: term, mode: 'insensitive' } })),
    { account: { name: { contains: term, mode: 'insensitive' } } },
    ...(/^-?\d{1,13}(?:\.\d{1,2})?$/.test(term) ? [{ amount: term }, { amountDiff: term }] : []),
  ] })) } as Prisma.TransactionWhereInput
}
