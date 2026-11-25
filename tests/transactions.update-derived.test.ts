import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  requireRole: vi.fn(),
  audit: vi.fn(),
  requireCapability: vi.fn(),
  invalidateFinancialReadModels: vi.fn(),
  syncTransactionReadModels: vi.fn(),
  db: {
    account: { findUnique: vi.fn() },
    transaction: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: mocks.getSession,
  requireRole: mocks.requireRole,
  audit: mocks.audit,
}))
vi.mock('@/lib/db/client', () => ({ db: mocks.db }))
vi.mock('@/lib/permissions/overrides', () => ({ requireCapability: mocks.requireCapability }))
vi.mock('@/lib/performance/cache', () => ({
  invalidateFinancialReadModels: mocks.invalidateFinancialReadModels,
}))
vi.mock('@/lib/performance/readModels', () => ({
  syncTransactionReadModels: mocks.syncTransactionReadModels,
}))

import { PUT } from '@/app/api/transactions/route'

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/transactions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({
    userId: 'admin-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN',
  })
  const existing = {
    id: 'tx-1', accountId: 'account-1', rawData: { accountName: 'Customer One' },
    status: 'PENDING_SC', amount: '10', shamCashTxId: 'SC-1', platformTxId: null,
    platformUserId: null, matchedTxId: null, notes: null, followUpStatus: null,
  }
  mocks.db.transaction.findUnique.mockResolvedValue(existing)
  mocks.db.account.findUnique.mockResolvedValue({ walletIdentifiers: [] })
  mocks.db.transaction.update.mockResolvedValue({ ...existing, notes: 'internal-transfer' })
  mocks.audit.mockResolvedValue(undefined)
})

describe('PUT /api/transactions derived fields', () => {
  it('recomputes compact list fields when notes change without mutating rawData', async () => {
    const response = await PUT(request({ id: 'tx-1', notes: 'internal-transfer' }))

    expect(response.status).toBe(200)
    expect(mocks.db.account.findUnique).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      select: { walletIdentifiers: true },
    })
    expect(mocks.db.transaction.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-1' },
      data: expect.objectContaining({
        notes: 'internal-transfer',
        customerName: 'Customer One',
        isInternalTransferAuto: true,
      }),
    }))
    expect(mocks.db.transaction.update.mock.calls[0]?.[0].data).not.toHaveProperty('rawData')
    expect(mocks.syncTransactionReadModels).toHaveBeenCalledTimes(1)
    expect(mocks.invalidateFinancialReadModels).toHaveBeenCalledTimes(1)
  })
})
