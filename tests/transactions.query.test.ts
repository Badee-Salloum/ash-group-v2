import { describe, expect, it } from 'vitest'
import {
  buildTransactionKeysetClause,
  decodeTransactionCursor,
  encodeTransactionCursor,
  InvalidTransactionCursorError,
  parseTransactionListQuery,
} from '@/lib/transactions/query'

describe('transaction list query helpers', () => {
  it('uses a bounded default and accepts only the supported page sizes', () => {
    expect(parseTransactionListQuery(new URLSearchParams())).toMatchObject({
      limit: 50,
      sortBy: 'txDateTime',
      sortDir: 'desc',
    })
    expect(parseTransactionListQuery(new URLSearchParams('limit=100')).limit).toBe(100)
    expect(() => parseTransactionListQuery(new URLSearchParams('limit=10000'))).toThrow()
  })

  it('ignores empty optional controls and rejects invalid calendar ranges', () => {
    const withoutEmptyControls = parseTransactionListQuery(new URLSearchParams('status=&search='))
    expect(withoutEmptyControls).not.toHaveProperty('status')
    expect(withoutEmptyControls).not.toHaveProperty('search')
    expect(() => parseTransactionListQuery(new URLSearchParams('dateFrom=2026-02-31'))).toThrow()
    expect(() => parseTransactionListQuery(new URLSearchParams('dateFrom=2026-05-02&dateTo=2026-05-01'))).toThrow()
  })

  it('round-trips a sort-bound opaque cursor and builds a stable keyset clause', () => {
    const cursor = encodeTransactionCursor({
      id: 'tx-2',
      value: '2026-05-01T10:00:00.000Z',
      sortBy: 'txDateTime',
      sortDir: 'desc',
    })
    const decoded = decodeTransactionCursor(cursor, { sortBy: 'txDateTime', sortDir: 'desc' })

    expect(buildTransactionKeysetClause(decoded)).toEqual({
      OR: [
        { txDateTime: { lt: new Date('2026-05-01T10:00:00.000Z') } },
        { txDateTime: new Date('2026-05-01T10:00:00.000Z'), id: { lt: 'tx-2' } },
      ],
    })
    expect(() => decodeTransactionCursor(cursor, { sortBy: 'amount', sortDir: 'desc' }))
      .toThrow(InvalidTransactionCursorError)
  })
})
