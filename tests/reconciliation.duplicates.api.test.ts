import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  db: {
    accountAccess: { findMany: vi.fn() },
    duplicateScGroup: { count: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/db/client', () => ({ db: mocks.db }))

import { GET } from '@/app/api/reconciliation/duplicates/route'
import {
  decodeDuplicateGroupCursor,
  encodeDuplicateGroupCursor,
} from '@/lib/reconciliation/duplicateGroups'

function request(path: string): NextRequest {
  const url = `http://localhost${path}`
  return { url, nextUrl: new URL(url) } as unknown as NextRequest
}

function group(id: string, lastSeenAt: string) {
  return {
    id,
    accountId: 'account-1',
    shamCashTxId: `SC-${id}`,
    pairCount: 2,
    hasCurrencyMismatch: false,
    lastSeenAt: new Date(lastSeenAt),
    refreshedAt: new Date('2026-05-02T00:00:00.000Z'),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({
    userId: 'admin-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN',
  })
  mocks.db.duplicateScGroup.count.mockResolvedValue(2)
  mocks.db.duplicateScGroup.findMany.mockResolvedValue([
    group('group-2', '2026-05-02T10:00:00.000Z'),
    group('group-1', '2026-05-01T10:00:00.000Z'),
  ])
  mocks.db.accountAccess.findMany.mockResolvedValue([])
})

describe('GET /api/reconciliation/duplicates', () => {
  it('returns a lightweight, cursor-paginated duplicate group summary', async () => {
    const response = await GET(request('/api/reconciliation/duplicates?limit=25'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(body).toMatchObject({
      success: true,
      pageInfo: { limit: 25, total: 2, hasNext: false, nextCursor: null },
    })
    expect(body.data[0]).toEqual(expect.objectContaining({
      id: 'group-2', accountId: 'account-1', shamCashTxId: 'SC-group-2', pairCount: 2,
    }))
    expect(body.data[0]).not.toHaveProperty('rawData')
    expect(mocks.db.duplicateScGroup.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 26,
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
    }))
  })

  it('does not widen a denied account-manager scope', async () => {
    mocks.getSession.mockResolvedValueOnce({
      userId: 'manager-1', email: 'manager@example.com', name: 'Manager', role: 'ACCOUNT_MGR',
    })
    mocks.db.accountAccess.findMany.mockResolvedValueOnce([{ accountId: 'account-allowed' }])

    await GET(request('/api/reconciliation/duplicates?accountId=account-other'))

    expect(mocks.db.duplicateScGroup.count).toHaveBeenCalledWith({
      where: { OR: [{ pairCount: { gt: 1 } }, { hasCurrencyMismatch: true }], accountId: { in: [] } },
    })
  })

  it('includes a one-pair currency mismatch with a distinct review reason', async () => {
    mocks.db.duplicateScGroup.findMany.mockResolvedValueOnce([
      { ...group('currency-group', '2026-09-25T17:38:01Z'), pairCount: 1, hasCurrencyMismatch: true },
    ])
    const response = await GET(request('/api/reconciliation/duplicates'))
    expect((await response.json()).data[0]).toMatchObject({
      pairCount: 1, hasDuplicateSc: false, hasCurrencyMismatch: true,
    })
  })

  it('rejects malformed cursors before querying group rows', async () => {
    const response = await GET(request('/api/reconciliation/duplicates?cursor=not-a-cursor'))

    expect(response.status).toBe(400)
    expect(mocks.db.duplicateScGroup.count).not.toHaveBeenCalled()
  })
})

describe('duplicate group cursor', () => {
  it('round-trips an opaque cursor with a stable date/id tie-breaker', () => {
    const value = encodeDuplicateGroupCursor({
      id: 'group-1', lastSeenAt: '2026-05-01T10:00:00.000Z',
    })
    expect(decodeDuplicateGroupCursor(value)).toEqual({
      id: 'group-1', lastSeenAt: '2026-05-01T10:00:00.000Z',
    })
  })
})
