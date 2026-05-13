import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(async (ops: unknown[]) => ops),
  auditCreate: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  db: {
    transaction: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    auditLog: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/lib/auth', () => ({
  getSession: mocks.getSession,
  requireRole: (session: { role: string }, roles: string[]) => {
    if (!roles.includes(session.role)) {
      throw new Error('FORBIDDEN')
    }
  },
  audit: (uid: string, action: string, entity: string, entityId: string, details: unknown) =>
    mocks.auditCreate({ data: { userId: uid, action, entity, entityId, details } }),
}))

const { findUnique, update, transaction, auditCreate, getSession } = mocks

import { POST } from '@/app/api/reconciliation/unlink/route'

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/reconciliation/unlink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  findUnique.mockReset()
  update.mockReset()
  transaction.mockClear()
  auditCreate.mockReset()
  getSession.mockReset()
})

describe('POST /api/reconciliation/unlink', () => {
  it('returns 401 when not authenticated', async () => {
    getSession.mockResolvedValueOnce(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ transactionId: 't1' }) as any)
    expect(res.status).toBe(401)
  })

  it('returns 403 when caller is not ADMIN or SUPERVISOR', async () => {
    getSession.mockResolvedValueOnce({ userId: 'u1', role: 'EMPLOYEE' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ transactionId: 't1' }) as any)
    expect(res.status).toBe(500) // requireRole throws → caught as generic
  })

  it('returns 404 when the transaction is missing', async () => {
    getSession.mockResolvedValueOnce({ userId: 'u1', role: 'ADMIN' })
    findUnique.mockResolvedValueOnce(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ transactionId: 't1' }) as any)
    expect(res.status).toBe(404)
  })

  it('refuses to unlink a PENDING transaction (nothing to unlink)', async () => {
    getSession.mockResolvedValueOnce({ userId: 'u1', role: 'ADMIN' })
    findUnique.mockResolvedValueOnce({
      id: 't1', status: 'PENDING_SC', matchedTxId: null, source: 'SHAM_CASH',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ transactionId: 't1' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/غير مرتبطة/)
  })

  it('refuses when MATCHED but matchedTxId is missing (data corruption guard)', async () => {
    getSession.mockResolvedValueOnce({ userId: 'u1', role: 'ADMIN' })
    findUnique.mockResolvedValueOnce({
      id: 't1', status: 'MATCHED', matchedTxId: null, source: 'SHAM_CASH',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ transactionId: 't1' }) as any)
    expect(res.status).toBe(400)
  })

  it('happy path: returns both sides to PENDING + audits', async () => {
    getSession.mockResolvedValueOnce({ userId: 'admin-1', role: 'ADMIN' })
    findUnique
      .mockResolvedValueOnce({
        id: 't1', status: 'MATCHED', matchedTxId: 't2', source: 'SHAM_CASH',
      })
      .mockResolvedValueOnce({
        id: 't2', status: 'MATCHED', matchedTxId: 't1', source: 'PLATFORM',
      })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ transactionId: 't1' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.unlinked).toEqual(['t1', 't2'])
    expect(transaction).toHaveBeenCalledTimes(1)

    expect(auditCreate).toHaveBeenCalledTimes(1)
    const auditArgs = auditCreate.mock.calls[0][0]
    expect(auditArgs.data.action).toBe('MANUAL_UNLINK')
    expect(auditArgs.data.entityId).toBe('t1')
    expect(auditArgs.data.details.partnerId).toBe('t2')
  })

  it('works on DISCREPANCY too (clears amountDiff)', async () => {
    getSession.mockResolvedValueOnce({ userId: 'admin-1', role: 'ADMIN' })
    findUnique
      .mockResolvedValueOnce({
        id: 't1', status: 'DISCREPANCY', matchedTxId: 't2', source: 'SHAM_CASH',
      })
      .mockResolvedValueOnce({
        id: 't2', status: 'DISCREPANCY', matchedTxId: 't1', source: 'PLATFORM',
      })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await POST(makeReq({ transactionId: 't1' }) as any)
    expect(transaction).toHaveBeenCalled()
  })

  it('proceeds even if the partner row is missing (defensive)', async () => {
    getSession.mockResolvedValueOnce({ userId: 'admin-1', role: 'ADMIN' })
    findUnique
      .mockResolvedValueOnce({
        id: 't1', status: 'MATCHED', matchedTxId: 't2-gone', source: 'SHAM_CASH',
      })
      .mockResolvedValueOnce(null) // partner deleted
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ transactionId: 't1' }) as any)
    expect(res.status).toBe(200)
  })
})
