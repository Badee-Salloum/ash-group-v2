import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  db: {
    accountAccess: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/db/client', () => ({ db: mocks.db }))

import { POST } from '@/app/api/reconciliation/bulk-match-info/route'

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/reconciliation/bulk-match-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({
    userId: 'supervisor-1',
    email: 'supervisor@example.com',
    name: 'Supervisor',
    role: 'SUPERVISOR',
  })
  mocks.db.accountAccess.findMany.mockResolvedValue([])
})

describe('POST /api/reconciliation/bulk-match-info', () => {
  it('rejects oversized requests before querying the database', async () => {
    const response = await POST(request({
      transactionIds: Array.from({ length: 101 }, (_, index) => `tx-${index}`),
    }))

    expect(response.status).toBe(400)
    expect(mocks.db.transaction.findMany).not.toHaveBeenCalled()
  })

  it('queries bounded, lightweight candidates for each visible source row', async () => {
    mocks.db.transaction.findMany
      .mockResolvedValueOnce([{
        id: 'source-1', accountId: 'account-1', type: 'DEPOSIT',
        status: 'PENDING_SC', amount: '100', currency: 'USD',
        txDateTime: new Date('2026-05-01T10:00:00.000Z'),
      }])
      .mockResolvedValueOnce([{
        id: 'candidate-1', amount: '100', txDateTime: new Date('2026-05-01T10:05:00.000Z'),
      }])

    const response = await POST(request({ transactionIds: ['source-1'] }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      data: {
        'source-1': { timeDiffSeconds: 300, amountDiff: 0, confidence: 100 },
      },
    })

    const sourceQuery = mocks.db.transaction.findMany.mock.calls[0]?.[0]
    const candidateQuery = mocks.db.transaction.findMany.mock.calls[1]?.[0]
    expect(sourceQuery.select).not.toHaveProperty('rawData')
    expect(candidateQuery.select).not.toHaveProperty('rawData')
    expect(candidateQuery.take).toBe(50)
    expect(candidateQuery.where.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'account-1' }),
    ]))
  })
})
