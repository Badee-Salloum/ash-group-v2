import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  requireRole: vi.fn(),
  db: {
    transaction: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: mocks.getSession,
  requireRole: mocks.requireRole,
}))
vi.mock('@/lib/db/client', () => ({ db: mocks.db }))

import { GET } from '@/app/api/reconciliation/suggest-match/route'

function request(id = 'source-1'): NextRequest {
  const url = `http://localhost/api/reconciliation/suggest-match?transactionId=${id}`
  return { nextUrl: new URL(url), url } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({
    userId: 'supervisor-1', email: 'supervisor@example.com', name: 'Supervisor', role: 'SUPERVISOR',
  })
  mocks.db.transaction.findUnique.mockResolvedValue({
    id: 'source-1', accountId: 'account-1', status: 'PENDING_SC', type: 'DEPOSIT',
    amount: '100', currency: 'USD', txDateTime: new Date('2026-05-01T10:00:00.000Z'),
    shamCashTxId: 'SC-1', platformTxId: null, account: { name: 'Main' },
  })
  mocks.db.transaction.findMany.mockResolvedValue([{
    id: 'candidate-1', source: 'PLATFORM', amount: '100', currency: 'USD',
    txDateTime: new Date('2026-05-01T10:05:00.000Z'), shamCashTxId: 'SC-1',
    platformTxId: 'P-1', platformUserId: 'user-1', customerName: 'Customer A',
  }])
})

describe('GET /api/reconciliation/suggest-match', () => {
  it('uses a bounded, normalized candidate query and never returns rawData', async () => {
    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.suggestions).toEqual([expect.objectContaining({
      matchId: 'candidate-1', customerName: 'Customer A', confidence: 100,
    })])
    expect(body.suggestions[0]).not.toHaveProperty('rawData')

    const sourceQuery = mocks.db.transaction.findUnique.mock.calls[0]?.[0]
    const candidateQuery = mocks.db.transaction.findMany.mock.calls[0]?.[0]
    expect(sourceQuery.select).not.toHaveProperty('rawData')
    expect(candidateQuery.select).not.toHaveProperty('rawData')
    expect(candidateQuery.take).toBe(100)
    expect(candidateQuery.where.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({
        accountId: 'account-1',
        isInternalTransferAuto: false,
      }),
      expect.objectContaining({
        OR: [{ reviewCategory: null }, { reviewCategory: { not: 'INTERNAL_TRANSFER' } }],
      }),
    ]))
  })
})
