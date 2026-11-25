import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TRANSACTION_LIST_SORT_FIELDS, parseTransactionListQuery, transactionListOrderBy, buildTransactionKeysetClause, cursorValueForTransaction, encodeTransactionCursor, decodeTransactionCursor } from '@/lib/transactions/query'
import { followUpOrderBy, FOLLOW_UP_SORT_KEYS } from '@/lib/tables/followUpSort'
const mocks = vi.hoisted(() => ({ sql: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: { $queryRawUnsafe: mocks.sql } }))
import { fetchDuplicateTransactionPage } from '@/lib/transactions/duplicatePage'

beforeEach(() => { vi.clearAllMocks(); mocks.sql.mockResolvedValue([]) })
describe('global transaction column sorts', () => {
  it.each(TRANSACTION_LIST_SORT_FIELDS)('accepts only allowlisted %s and keeps an id tie-breaker', key => {
    for (const direction of ['asc', 'desc']) {
      const query = parseTransactionListQuery(new URLSearchParams(`sortBy=${key}&sortDir=${direction}`))
      expect(transactionListOrderBy(query).at(-1)).toEqual({ id: direction })
    }
  })
  it('uses PostgreSQL enum order rather than unsupported Prisma enum range filters', () => {
    const clause = buildTransactionKeysetClause({ id: 'x', value: 'PENDING_SC', sortBy: 'status', sortDir: 'asc' })
    expect(clause).toEqual({ OR: [
      { status: { in: ['PENDING_P', 'DISCREPANCY', 'WASTE', 'RETURNS'] } },
      { status: 'PENDING_SC', id: { gt: 'x' } },
    ] })
  })
  it('walks nullable scalar values before the null bucket in both directions', () => {
    for (const direction of ['asc', 'desc'] as const) {
      const clause = buildTransactionKeysetClause({ id: 'x', value: '5.50', sortBy: 'amountDiff', sortDir: direction })
      expect(clause.OR).toContainEqual({ amountDiff: null })
      expect(transactionListOrderBy({ sortBy: 'amountDiff', sortDir: direction })[0]).toEqual({ amountDiff: { sort: direction, nulls: 'last' } })
      expect(buildTransactionKeysetClause({ id: 'x', value: null, sortBy: 'amountDiff', sortDir: direction })).toEqual({ OR: [
        { AND: [{ amountDiff: null }, { id: { [direction === 'asc' ? 'gt' : 'lt']: 'x' } }] },
      ] })
    }
  })
  it('matches optional relation null ordering, including descending null-first transitions', () => {
    const clause = buildTransactionKeysetClause({ id: 'x', value: null, sortBy: 'handledByUser', sortDir: 'desc' })
    expect(clause.OR).toContainEqual({ handledByUser: { isNot: null } })
    expect(buildTransactionKeysetClause({ id: 'x', value: 'Ali', sortBy: 'handledByUser', sortDir: 'desc' }).OR).not.toContainEqual({ handledByUser: null })
  })
  it('uses the same effective identifier shown in the row and cursor', () => {
    expect(cursorValueForTransaction({ platformUserId: null, matchedTx: { platformUserId: 'partner-user' } }, 'platformUserId')).toBe('partner-user')
    expect(cursorValueForTransaction({ batch: { createdAt: new Date('2026-10-01') } }, 'batch')).toBe('2026-10-01T00:00:00.000Z')
  })
  it('handles boolean queue sorting without unsupported gt/lt boolean filters', () => {
    expect(buildTransactionKeysetClause({ id: 'x', value: 'false', sortBy: 'hasDelay', sortDir: 'asc' }).OR).toContainEqual({ hasDelay: true })
    expect(buildTransactionKeysetClause({ id: 'x', value: 'true', sortBy: 'hasDelay', sortDir: 'asc' }).OR).toEqual([{ hasDelay: true, id: { gt: 'x' } }])
  })
  it('rejects malformed enum, decimal, date and null cursors', () => {
    for (const [key, value] of [['status', 'unknown'], ['amount', '1; DROP TABLE'], ['txDateTime', 'invalid'], ['amount', null], ['hasDelay', 'maybe']] as const) {
      const cursor = encodeTransactionCursor({ id: 'x', sortBy: key, value, sortDir: 'asc' })
      expect(() => decodeTransactionCursor(cursor, { sortBy: key, sortDir: 'asc' })).toThrow()
    }
  })
  it.each(['amountDiff', 'status', 'account', 'handledByUser', 'batch', 'platformUserId', 'customerName', 'notes'] as const)('orders duplicate SQL by %s without extracting all rows', async key => {
    const query = parseTransactionListQuery(new URLSearchParams(`duplicates=1&sortBy=${key}&sortDir=asc&limit=25`))
    await fetchDuplicateTransactionPage(query, ['allowed'])
    const sql = mocks.sql.mock.calls[1][0] as string
    expect(sql).toContain('ORDER BY ')
    expect(sql).toContain(' ASC NULLS LAST, t.id ASC')
    expect(mocks.sql.mock.calls[1]).toContain(26)
    expect(mocks.sql.mock.calls[1]).toContainEqual(['allowed'])
  })
  it('uses effective IDs from the linked transaction without depending on duplicate membership', async () => {
    await fetchDuplicateTransactionPage(parseTransactionListQuery(new URLSearchParams('sortBy=platformTxId')), ['allowed'])
    const sql = mocks.sql.mock.calls[1][0] as string
    expect(sql).toContain('COALESCE(NULLIF(t."platformTxId", \'\')')
    expect(sql).not.toContain('duplicate_sc_groups')
    expect(sql).toContain(`NOT (t.status = 'MATCHED' AND t.source = 'PLATFORM')`)
  })
  it('counts all filtered records rather than just those after the cursor', async () => {
    const cursor = encodeTransactionCursor({ id: 'x', value: '75', sortBy: 'amount', sortDir: 'asc' })
    await fetchDuplicateTransactionPage(parseTransactionListQuery(new URLSearchParams(`duplicates=1&sortBy=amount&sortDir=asc&cursor=${cursor}`)))
    expect(mocks.sql.mock.calls[0]).not.toContain('75')
    expect(mocks.sql.mock.calls[1]).toContain('75')
  })
  it.each(FOLLOW_UP_SORT_KEYS)('orders follow-up %s before paging with a stable id', key => {
    expect(followUpOrderBy(new URLSearchParams(`sortBy=${key}&sortDir=desc`)).at(-1)).toEqual({ id: 'desc' })
  })
  it('rejects arbitrary follow-up field paths and SQL fragments', () => {
    expect(() => followUpOrderBy(new URLSearchParams('sortBy=rawData'))).toThrow()
    expect(() => followUpOrderBy(new URLSearchParams('sortBy=amount&sortDir=desc;drop'))).toThrow()
  })
})
