import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  requireRole: vi.fn(),
  audit: vi.fn(),
  requireCapability: vi.fn(),
  db: {
    accountAccess: { findMany: vi.fn() },
    transaction: { count: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: mocks.getSession,
  requireRole: mocks.requireRole,
  audit: mocks.audit,
}))
vi.mock('@/lib/db/client', () => ({ db: mocks.db }))
vi.mock('@/lib/permissions/overrides', () => ({ requireCapability: mocks.requireCapability }))
vi.mock('@/lib/performance/cache', () => ({ invalidateFinancialReadModels: vi.fn() }))
vi.mock('@/lib/performance/readModels', () => ({ syncTransactionReadModels: vi.fn() }))

import { GET } from '@/app/api/transactions/route'

function request(path: string): NextRequest {
  const url = `http://localhost${path}`
  return { url, nextUrl: new URL(url) } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({
    userId: 'admin-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN',
  })
  mocks.db.transaction.count.mockResolvedValue(0)
  mocks.db.transaction.findMany.mockResolvedValue([])
  mocks.db.$queryRaw.mockResolvedValue([])
})

describe('legacy GET /api/transactions performance guard', () => {
  it('caps a legacy oversized page request and skips duplicate aggregation by default', async () => {
    const response = await GET(request('/api/transactions?pageSize=10000'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.meta).toMatchObject({ page: 1, pageSize: 100, total: 0 })
    expect(mocks.db.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
    expect(mocks.db.$queryRaw).not.toHaveBeenCalled()
  })
})
