import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  db: {
    $queryRawUnsafe: vi.fn(),
    accountAccess: { findMany: vi.fn() },
    customer: { findMany: vi.fn() },
    duplicateScGroup: { findMany: vi.fn(), count: vi.fn() },
    transaction: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/db/client', () => ({ db: mocks.db }))

import { GET as getList } from '@/app/api/transactions/query/route'
import { GET as getDetail } from '@/app/api/transactions/[id]/route'

function request(path: string): NextRequest {
  const url = `http://localhost${path}`
  return { url, nextUrl: new URL(url) } as unknown as NextRequest
}

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    accountId: 'account-1',
    batchId: 'batch-1',
    source: 'SHAM_CASH',
    type: 'DEPOSIT',
    shamCashTxId: 'SC-1',
    platformTxId: null,
    platformUserId: 'user-1',
    amount: '42.50',
    currency: 'USD',
    txDateTime: new Date('2026-05-01T10:00:00.000Z'),
    status: 'PENDING_SC',
    matchedTxId: null,
    amountDiff: null,
    customerName: 'Customer One',
    isInternalTransferAuto: false,
    notes: 'normalized note',
    reviewCategory: null,
    reviewNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    followUpStatus: null,
    handledByUserId: null,
    handlerAmbiguous: false,
    createdAt: new Date('2026-05-01T10:00:00.000Z'),
    updatedAt: new Date('2026-05-01T10:00:00.000Z'),
    account: { id: 'account-1', name: 'Main', currency: 'USD' },
    matchedTx: null,
    handledByUser: null,
    batch: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({
    userId: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin',
    role: 'ADMIN',
  })
  mocks.db.transaction.count.mockResolvedValue(1)
  mocks.db.transaction.findMany.mockReset()
    .mockResolvedValueOnce([listRow()])
    .mockResolvedValueOnce([])
  mocks.db.customer.findMany.mockResolvedValue([])
  mocks.db.duplicateScGroup.findMany.mockResolvedValue([])
  mocks.db.duplicateScGroup.count.mockResolvedValue(0)
  mocks.db.$queryRawUnsafe.mockResolvedValue([])
  mocks.db.accountAccess.findMany.mockResolvedValue([])
})

describe('GET /api/transactions/query', () => {
  it('returns a bounded lightweight list without rawData', async () => {
    const response = await getList(request('/api/transactions/query?limit=25'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(body).toMatchObject({
      success: true,
      pageInfo: { limit: 25, total: 1, hasNext: false, nextCursor: null },
    })
    expect(body.data[0]).toMatchObject({
      id: 'tx-1',
      amount: 42.5,
      customerName: 'Customer One',
      displayNotes: 'normalized note',
    })
    expect(body.data[0]).not.toHaveProperty('rawData')

    const primaryListQuery = mocks.db.transaction.findMany.mock.calls[0]?.[0]
    expect(primaryListQuery.take).toBe(26)
    expect(primaryListQuery.select).not.toHaveProperty('rawData')
    expect(primaryListQuery.select.matchedTx.select).not.toHaveProperty('rawData')
  })

  it('denies employees before issuing database queries', async () => {
    mocks.getSession.mockResolvedValueOnce({
      userId: 'employee-1', email: 'employee@example.com', name: 'Employee', role: 'EMPLOYEE',
    })

    const response = await getList(request('/api/transactions/query'))

    expect(response.status).toBe(403)
    expect(mocks.db.transaction.count).not.toHaveBeenCalled()
    expect(mocks.db.transaction.findMany).not.toHaveBeenCalled()
  })

  it('keeps an account manager inside their granted account scope', async () => {
    mocks.getSession.mockResolvedValueOnce({
      userId: 'manager-1', email: 'manager@example.com', name: 'Manager', role: 'ACCOUNT_MGR',
    })
    mocks.db.accountAccess.findMany.mockResolvedValueOnce([{ accountId: 'account-allowed' }])

    await getList(request('/api/transactions/query?accountId=account-other'))

    const primaryListQuery = mocks.db.transaction.findMany.mock.calls[0]?.[0]
    expect(primaryListQuery.where.AND).toContainEqual({ accountId: { in: [] } })
  })

  it('keeps manually reviewed internal transfers visible when hiding auto wallet rows', async () => {
    await getList(request('/api/transactions/query?excludeWalletTransfers=1'))

    const primaryListQuery = mocks.db.transaction.findMany.mock.calls[0]?.[0]
    expect(primaryListQuery.where.AND).toContainEqual({
      OR: [
        { status: { not: 'PENDING_SC' } },
        { isInternalTransferAuto: false },
        { reviewCategory: 'INTERNAL_TRANSFER' },
      ],
    })
  })

  it('uses a bounded database join for duplicate rows instead of materializing all groups', async () => {
    mocks.db.duplicateScGroup.count.mockResolvedValueOnce(1)
    mocks.db.$queryRawUnsafe.mockImplementation((sql: string) => {
      if (sql.includes('count(*) AS total')) return Promise.resolve([{ total: '1' }])
      return Promise.resolve([{ id: 'tx-1', hasDuplicateSc: true }])
    })
    mocks.db.transaction.findMany.mockReset().mockResolvedValue([listRow()])

    const response = await getList(request('/api/transactions/query?duplicates=1&limit=25'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      pageInfo: { limit: 25, total: 1, hasNext: false },
      duplicateScCount: 1,
    })
    expect(mocks.db.duplicateScGroup.findMany).not.toHaveBeenCalled()
    expect(mocks.db.$queryRawUnsafe).toHaveBeenCalledTimes(2)
    const pageSql = mocks.db.$queryRawUnsafe.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .find((sql: string) => sql.includes('SELECT t.id'))
    expect(pageSql).toContain('INNER JOIN "duplicate_sc_groups"')
    expect(pageSql).toContain('LIMIT $1')
    expect(mocks.db.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['tx-1'] } },
    }))
    expect(body.data[0].hasDuplicateSc).toBe(true)
    expect(body.data[0].hasCurrencyMismatch).toBe(false)
  })

  it('includes both sides of a single cross-currency pair without falsely labelling it duplicate', async () => {
    const rows = [
      listRow({ id: 'sc', currency: 'SYP', status: 'MATCHED', matchedTxId: 'platform',
        matchedTx: { id: 'platform', amount: '140', currency: 'USD', source: 'PLATFORM' } }),
      listRow({ id: 'platform', currency: 'USD', source: 'PLATFORM', status: 'MATCHED', matchedTxId: 'sc',
        matchedTx: { id: 'sc', amount: '140', currency: 'SYP', source: 'SHAM_CASH' } }),
    ]
    mocks.db.$queryRawUnsafe.mockImplementation((sql: string) => Promise.resolve(
      sql.includes('count(*) AS total') ? [{ total: '2' }] : rows.map(row => ({ id: row.id, hasDuplicateSc: false })),
    ))
    mocks.db.transaction.findMany.mockReset().mockResolvedValue([...rows].reverse())

    const response = await getList(request('/api/transactions/query?duplicates=1&search=476153071&limit=25'))
    const body = await response.json()
    expect(body.pageInfo.total).toBe(2)
    expect(body.data.map((row: { id: string }) => row.id)).toEqual(['sc', 'platform'])
    for (const row of body.data) {
      expect(row.hasCurrencyMismatch).toBe(true)
      expect(row.hasDuplicateSc).toBe(false)
      expect(row).not.toHaveProperty('rawData')
    }
    const sql = mocks.db.$queryRawUnsafe.mock.calls[0][0]
    expect(sql).toContain('OR d."hasCurrencyMismatch" = TRUE')
    expect(mocks.db.duplicateScGroup.count).toHaveBeenCalledWith({
      where: { OR: [{ pairCount: { gt: 1 } }, { hasCurrencyMismatch: true }] },
    })
  })

  it('does not query review rows outside an account manager scope', async () => {
    mocks.getSession.mockResolvedValueOnce({ userId: 'manager-1', role: 'ACCOUNT_MGR' })
    mocks.db.accountAccess.findMany.mockResolvedValueOnce([{ accountId: 'allowed' }])
    const response = await getList(request('/api/transactions/query?duplicates=1&accountId=denied'))
    expect((await response.json()).data).toEqual([])
    expect(mocks.db.$queryRawUnsafe).not.toHaveBeenCalled()
    expect(mocks.db.transaction.findMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/transactions/[id]', () => {
  it('loads raw detail only for one scoped record', async () => {
    mocks.db.transaction.findFirst.mockResolvedValueOnce({ id: 'tx-1', rawData: { source: 'xlsx' } })

    const response = await getDetail(request('/api/transactions/tx-1'), { params: { id: 'tx-1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, data: { id: 'tx-1', rawData: { source: 'xlsx' } } })
    expect(mocks.db.transaction.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-1' },
    }))
  })
})
