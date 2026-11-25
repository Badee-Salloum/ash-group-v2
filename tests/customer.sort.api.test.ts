import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ session: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), access: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/db/client', () => ({ db: { transaction: { findMany: mocks.findMany, count: mocks.count, groupBy: mocks.groupBy }, accountAccess: { findMany: mocks.access } } }))
vi.mock('@/lib/reconciliation/customerNames', () => ({ lookupCustomerNames: vi.fn(async () => new Map()), lookupCustomerUserIdsByDisplayName: vi.fn(async () => []) }))
import { GET } from '@/app/api/customers/[name]/route'
const request = (query: string) => ({ nextUrl: new URL(`http://localhost/api/customers/USER-1?${query}`) }) as NextRequest
function row(id: string, amount: string) {
  return { id, accountId: 'a', amount, currency: 'USD', type: 'DEPOSIT', source: 'SHAM_CASH', status: 'PENDING_SC', txDateTime: new Date('2026-10-12T09:00:00Z'),
    shamCashTxId: 'SC', platformTxId: null, platformUserId: '1', amountDiff: null, notes: null, matchedTxId: null, reviewCategory: null, reviewNotes: null, customerName: 'Name', account: { name: 'A' }, batch: null }
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ userId: 'admin', role: 'ADMIN' })
  mocks.findMany.mockResolvedValue([row('a', '10')])
  mocks.count.mockResolvedValue(80)
  mocks.groupBy.mockResolvedValue([])
})
describe('customer detail sorting API', () => {
  it('orders the full result in SQL and caps the fetched page', async () => {
    const response = await GET(request('sortBy=amount&sortDir=asc&limit=25'), { params: { name: 'USER-1' } })
    expect(response.status).toBe(200)
    expect(mocks.findMany.mock.calls[0][0]).toMatchObject({ take: 26, orderBy: [{ amount: 'asc' }, { id: 'asc' }] })
    expect(mocks.findMany.mock.calls[0][0].select).not.toHaveProperty('rawData')
  })
  it('continues equal-amount pages using id instead of skipping or repeating rows', async () => {
    mocks.findMany.mockResolvedValueOnce(Array.from({ length: 26 }, (_, i) => row(`id-${i}`, '75')))
    const first = await (await GET(request('sortBy=amount&sortDir=asc&limit=25'), { params: { name: 'USER-1' } })).json()
    const response = await GET(request(`sortBy=amount&sortDir=asc&limit=25&cursor=${first.pageInfo.nextCursor}`), { params: { name: 'USER-1' } })
    expect(response.status).toBe(200)
    expect(mocks.findMany.mock.calls[1][0].where.AND[1]).toEqual({ OR: [
      { amount: { gt: '75' } }, { AND: [{ amount: '75' }, { id: { gt: 'id-24' } }] },
    ] })
  })
  it('applies search and hide-matched before counting and paging, not to the summary', async () => {
    await GET(request('sortBy=amount&sortDir=desc&hideMatched=true&search=75'), { params: { name: 'USER-1' } })
    expect(JSON.stringify(mocks.count.mock.calls[0][0])).toContain('"amount":"75"')
    expect(JSON.stringify(mocks.count.mock.calls[0][0])).toContain('"not":"MATCHED"')
    expect(JSON.stringify(mocks.groupBy.mock.calls[0][0])).not.toContain('"amount":"75"')
  })
  it('rejects unsupported ordering before querying financial rows', async () => {
    expect((await GET(request('sortBy=rawData'), { params: { name: 'USER-1' } })).status).toBe(400)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
  it('retains the account-manager permission scope under amount ordering', async () => {
    mocks.session.mockResolvedValue({ userId: 'manager', role: 'ACCOUNT_MGR' })
    mocks.access.mockResolvedValue([{ accountId: 'allowed' }])
    await GET(request('sortBy=amount&sortDir=desc'), { params: { name: 'USER-1' } })
    expect(JSON.stringify(mocks.findMany.mock.calls[0][0].where)).toContain('"accountId":{"in":["allowed"]}')
  })
})
