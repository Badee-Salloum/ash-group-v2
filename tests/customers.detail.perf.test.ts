import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  db: {
    $executeRawUnsafe: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    accountAccess: { findMany: vi.fn() },
    customer: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    transaction: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/db/client', () => ({ db: mocks.db }))

import { GET as getCustomerDetail } from '@/app/api/customers/[name]/route'
import { GET as getCustomerByUser } from '@/app/api/customers/by-user/[userId]/route'

function request(path: string): NextRequest {
  const url = `http://localhost${path}`
  return { url, nextUrl: new URL(url) } as unknown as NextRequest
}

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    accountId: 'account-1',
    type: 'DEPOSIT',
    status: 'PENDING_SC',
    source: 'SHAM_CASH',
    amount: '42.50',
    currency: 'USD',
    txDateTime: new Date('2026-05-01T10:00:00.000Z'),
    shamCashTxId: 'SC-1',
    platformTxId: null,
    platformUserId: 'user-1',
    amountDiff: null,
    notes: 'normalized note',
    matchedTxId: null,
    reviewCategory: null,
    reviewNotes: null,
    customerName: 'Customer One',
    account: { name: 'Main' },
    batch: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({
    userId: 'admin-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN',
  })
  mocks.db.$executeRawUnsafe.mockResolvedValue(0)
  mocks.db.customer.findMany.mockResolvedValue([])
  mocks.db.transaction.count.mockResolvedValue(1)
  mocks.db.transaction.groupBy.mockResolvedValue([
    { currency: 'USD', type: 'DEPOSIT', status: 'PENDING_SC', _count: { _all: 1 }, _sum: { amount: '42.50' } },
  ])
  mocks.db.transaction.findMany
    .mockResolvedValueOnce([{ platformUserId: 'user-1' }])
    .mockResolvedValueOnce([detailRow()])
  mocks.db.$queryRawUnsafe.mockResolvedValue([])
  mocks.db.accountAccess.findMany.mockResolvedValue([])
})

describe('customer drill-down performance contract', () => {
  it('uses a bounded normalized page and excludes rawData', async () => {
    const response = await getCustomerDetail(
      request('/api/customers/Customer%20One?limit=25'),
      { params: { name: 'Customer%20One' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      pageInfo: { limit: 25, total: 1, hasNext: false, nextCursor: null },
      summary: { depositCount: 1, totalOps: 1 },
    })
    expect(body.data[0]).toMatchObject({ id: 'tx-1', amount: 42.5, accountLabel: 'Main' })
    expect(body.data[0]).not.toHaveProperty('rawData')

    const pageCall = mocks.db.transaction.findMany.mock.calls
      .map((call: unknown[]) => call[0])
      .find((args: unknown) => (args as { take?: number }).take === 26) as {
        select: { batch: { select: Record<string, unknown> } } & Record<string, unknown>
      } | undefined
    expect(pageCall).toBeDefined()
    expect(pageCall?.select).not.toHaveProperty('rawData')
    expect(pageCall?.select.batch.select).not.toHaveProperty('rawData')
  })

  it('denies employees before querying a customer drill-down', async () => {
    mocks.getSession.mockResolvedValueOnce({
      userId: 'employee-1', email: 'employee@example.com', name: 'Employee', role: 'EMPLOYEE',
    })

    const response = await getCustomerDetail(
      request('/api/customers/Customer%20One'),
      { params: { name: 'Customer%20One' } },
    )

    expect(response.status).toBe(403)
    expect(mocks.db.transaction.findMany).not.toHaveBeenCalled()
  })

  it('resolves a user through customerName rather than rawData', async () => {
    mocks.db.$queryRawUnsafe.mockResolvedValueOnce([{ name: 'Customer One', count: 3 }])

    const response = await getCustomerByUser(
      request('/api/customers/by-user/user-1'),
      { params: { userId: 'user-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: true, name: 'Customer One', source: 'transaction-customerName' })
    const sql = String(mocks.db.$queryRawUnsafe.mock.calls[0]?.[0])
    expect(sql).toContain('"customerName"')
    expect(sql).not.toContain('rawData')
  })
})
