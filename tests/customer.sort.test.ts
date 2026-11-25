import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_TX_SORT_KEYS, parseCustomerSort, encodeCustomerCursor, decodeCustomerCursor,
  customerOrderBy, customerCursorWhere, customerSearchWhere,
} from '@/lib/customers/transactionSort'
import { parseUploadSort, uploadOrderBy } from '@/lib/uploads/sort'

describe('customer transaction keyset sorting', () => {
  it('defaults to newest date with a stable id tie-breaker', () => {
    const sort = parseCustomerSort(new URLSearchParams())
    expect(customerOrderBy(sort)).toEqual([{ txDateTime: 'desc' }, { id: 'desc' }])
  })
  it.each(['asc', 'desc'] as const)('preserves decimal amounts in %s cursors', direction => {
    const sort = { key: 'amount' as const, direction }
    const value = '9999999999999.99'
    const cursor = encodeCustomerCursor({ id: 'b', amount: { toString: () => value } }, sort, 'customer')
    const decoded = decodeCustomerCursor(cursor, sort, 'customer')
    expect(decoded).toEqual({ id: 'b', value })
    const op = direction === 'asc' ? 'gt' : 'lt'
    expect(customerCursorWhere(decoded, sort)).toEqual({ OR: [
      { amount: { [op]: value } }, { AND: [{ amount: value }, { id: { [op]: 'b' } }] },
    ] })
  })
  it.each(['asc', 'desc'] as const)('keeps null differences last in %s pages', direction => {
    const sort = { key: 'amountDiff' as const, direction }
    expect(customerOrderBy(sort)).toEqual([{ amountDiff: { sort: direction, nulls: 'last' } }, { id: direction }])
    expect(customerCursorWhere({ id: 'b', value: '3' }, sort)).toMatchObject({ OR: [{}, {}, { amountDiff: null }] })
    expect(customerCursorWhere({ id: 'b', value: null }, sort)).toEqual({ AND: [{ amountDiff: null }, { id: { [direction === 'asc' ? 'gt' : 'lt']: 'b' } }] })
  })
  it('uses relation name and id for account sorting', () => {
    const sort = { key: 'accountLabel' as const, direction: 'asc' as const }
    expect(customerOrderBy(sort)).toEqual([{ account: { name: 'asc' } }, { id: 'asc' }])
    expect(customerCursorWhere({ id: 'id', value: 'Account' }, sort)).toEqual({ OR: [
      { account: { name: { gt: 'Account' } } }, { AND: [{ account: { name: 'Account' } }, { id: { gt: 'id' } }] },
    ] })
  })
  it('uses supported enum membership filters instead of invalid enum gt/lt', () => {
    expect(customerCursorWhere({ id: 'id', value: 'WITHDRAWAL' }, { key: 'type', direction: 'desc' }))
      .toEqual({ OR: [{ type: { in: ['DEPOSIT'] } }, { AND: [{ type: 'WITHDRAWAL' }, { id: { lt: 'id' } }] }] })
  })
  it.each(CUSTOMER_TX_SORT_KEYS)('accepts the %s display column', key => {
    expect(parseCustomerSort(new URLSearchParams({ sortBy: key, sortDir: 'asc' }))).toEqual({ key, direction: 'asc' })
  })
  it('rejects unsupported columns, injected identifiers, and malformed directions', () => {
    for (const params of [{ sortBy: 'rawData' }, { sortBy: 'amount; DROP TABLE transactions' }, { sortDir: 'sideways' }] as Array<Record<string, string>>) {
      expect(() => parseCustomerSort(new URLSearchParams(params))).toThrow()
    }
  })
  it('rejects cursors after a sort, direction or filter change', () => {
    const sort = { key: 'amount' as const, direction: 'asc' as const }
    const token = encodeCustomerCursor({ id: 'a', amount: 75 }, sort, 'filter-1')
    expect(() => decodeCustomerCursor(token, { key: 'txDateTime', direction: 'asc' }, 'filter-1')).toThrow()
    expect(() => decodeCustomerCursor(token, { ...sort, direction: 'desc' }, 'filter-1')).toThrow()
    expect(() => decodeCustomerCursor(token, sort, 'filter-2')).toThrow()
  })
  it('retains compatibility for an already-open default-date tab', () => {
    const token = Buffer.from(JSON.stringify({ id: 'id', txDateTime: '2026-10-12T09:00:00Z' })).toString('base64url')
    expect(decodeCustomerCursor(token, { key: 'txDateTime', direction: 'desc' }, 'scope')).toMatchObject({ id: 'id' })
  })
  it('keeps monetary search and text search in the database predicate', () => {
    const predicate = JSON.stringify(customerSearchWhere('75، REF'))
    expect(predicate).toContain('"amount":"75"')
    expect(predicate).toContain('"contains":"REF"')
    expect(predicate).not.toContain('rawData')
  })
})

describe('upload history ordering', () => {
  it('sorts numeric counts globally with a stable id tie-breaker', () => {
    expect(uploadOrderBy(parseUploadSort(new URLSearchParams({ sortBy: 'rowsProcessed', sortDir: 'desc' }))))
      .toEqual([{ rowsProcessed: 'desc' }, { id: 'desc' }])
  })
  it('sorts account and uploader names through their relations', () => {
    expect(uploadOrderBy({ key: 'accountName', direction: 'asc' })[0]).toEqual({ account: { name: 'asc' } })
    expect(uploadOrderBy({ key: 'uploaderName', direction: 'desc' })[0]).toEqual({ uploader: { name: 'desc' } })
  })
  it('keeps unprocessed batches last and rejects unsupported fields', () => {
    expect(uploadOrderBy({ key: 'processedAt', direction: 'desc' })[0]).toEqual({ processedAt: { sort: 'desc', nulls: 'last' } })
    expect(() => parseUploadSort(new URLSearchParams({ sortBy: 'rawData' }))).toThrow()
  })
})
