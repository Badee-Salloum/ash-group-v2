import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { CUSTOMER_DIRECTORY_SORT_KEYS, parseDirectorySort, encodeDirectoryCursor, decodeDirectoryCursor } from '@/lib/customers/directorySort'
const mocks = vi.hoisted(() => ({ session: vi.fn(), sql: vi.fn(), access: vi.fn(), cache: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/db/client', () => ({ db: { $queryRawUnsafe: mocks.sql, accountAccess: { findMany: mocks.access } } }))
vi.mock('@/lib/performance/readiness', () => ({ performanceReadModelsReady: async () => true }))
vi.mock('@/lib/performance/cache', () => ({ CACHE_TAGS: { customers: 'customers' }, cachedPrivateRead: mocks.cache,
  estimateJsonBytes: () => 100, requestMetricsHeaders: () => ({ 'Cache-Control': 'private, no-store' }) }))
import { GET } from '@/app/api/customers/query/route'
const request = (params: string) => ({ nextUrl: new URL(`http://localhost/api/customers/query?${params}`) }) as NextRequest
const row = (index: number) => ({ name: `Customer ${index}`, depositCount: 2, withdrawalCount: 1, depositSum: { USD: 10 }, withdrawalSum: { USD: 1 },
  matchedCount: 2, pendingCount: 1, discrepancyCount: 0, firstSeen: new Date('2026-01-01'), lastSeen: new Date('2026-10-01'), sortValue: '10.00', total: 100 })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ userId: 'admin', role: 'ADMIN' })
  mocks.sql.mockResolvedValue([row(1)])
  mocks.access.mockResolvedValue([{ accountId: 'allowed' }])
  mocks.cache.mockImplementation((_key, _tags, fn) => fn())
})
describe('customer directory global sorting', () => {
  it.each(CUSTOMER_DIRECTORY_SORT_KEYS)('sorts %s in SQL before LIMIT, with a stable name tie-breaker', async key => {
    const response = await GET(request(`sortBy=${key}&sortDir=asc&sortCurrency=USD`))
    expect(response.status).toBe(200)
    const sql = mocks.sql.mock.calls[0][0] as string
    expect(sql).toMatch(/ORDER BY [\s\S]+ ASC, cr.name ASC\s+LIMIT/)
    expect(response.headers.get('Cache-Control')).toContain('private')
  })
  it('compares only the chosen currency, never the sum of all currencies', async () => {
    await GET(request('sortBy=balance&sortCurrency=SYP'))
    const [sql, ...bindings] = mocks.sql.mock.calls[0]
    expect(sql).toContain('"depositSum"->>$1')
    expect(sql).toContain('"withdrawalSum"->>$1')
    expect(bindings[0]).toBe('SYP')
  })
  it('continues equal-valued pages using customer name and binds the exact decimal value', async () => {
    mocks.sql.mockResolvedValueOnce(Array.from({ length: 26 }, (_, i) => row(i)))
    const first = await (await GET(request('limit=25&sortBy=depositSum&sortDir=asc'))).json()
    const response = await GET(request(`limit=25&sortBy=depositSum&sortDir=asc&cursor=${first.pageInfo.nextCursor}`))
    expect(response.status).toBe(200)
    expect(mocks.sql.mock.calls[1][0]).toContain('cr.name) > (')
    expect(mocks.sql.mock.calls[1]).toContain('10.00')
    expect(mocks.sql.mock.calls[1]).toContain('Customer 24')
  })
  it('rejects unsupported sort and malformed cursors before SQL', async () => {
    expect((await GET(request('sortBy=rawData'))).status).toBe(400)
    expect((await GET(request('cursor=invalid'))).status).toBe(400)
    expect(mocks.sql).not.toHaveBeenCalled()
  })
  it('retains account permissions and includes sort/currency in the private cache key', async () => {
    mocks.session.mockResolvedValue({ userId: 'manager', role: 'ACCOUNT_MGR' })
    await GET(request('sortBy=depositSum&sortCurrency=USD'))
    await GET(request('sortBy=depositSum&sortCurrency=SYP'))
    expect(mocks.sql.mock.calls[0][0]).toContain('cs."accountId" = ANY($1::text[])')
    expect(mocks.sql.mock.calls[0][1]).toEqual(['allowed'])
    expect(mocks.cache.mock.calls[0][0]).not.toBe(mocks.cache.mock.calls[1][0])
  })
  it('binds directory cursors to permissions, filters, currency and direction', () => {
    const sort = parseDirectorySort(new URLSearchParams('sortBy=depositSum'))
    const cursor = encodeDirectoryCursor(row(1), sort, 'scope-one')
    expect(decodeDirectoryCursor(cursor, sort, 'scope-one')).toEqual({ name: 'Customer 1', value: '10.00' })
    expect(() => decodeDirectoryCursor(cursor, sort, 'scope-two')).toThrow()
    expect(() => decodeDirectoryCursor(cursor, { ...sort, currency: 'SYP' }, 'scope-one')).toThrow()
    expect(() => decodeDirectoryCursor(cursor, { ...sort, direction: 'asc' }, 'scope-one')).toThrow()
  })
})
