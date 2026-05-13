import { describe, it, expect, beforeEach, vi } from 'vitest'

// Exercises the REAL tryAutoApproveHandover function from
// src/lib/shifts/autoApprove.ts with a mocked Prisma client. This catches
// regressions the pure-logic gate test can't (e.g., trigger-side dispatch,
// audit calls, transaction usage).
//
// vi.mock factories are hoisted above all other code, so the mock fns must
// live inside `vi.hoisted()` to be referenceable from the factory.

const mocks = vi.hoisted(() => {
  const findUnique = vi.fn()
  const findFirst = vi.fn()
  const updateMany = vi.fn()
  const shiftFindFirst = vi.fn()
  const auditLogCreate = vi.fn()
  const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
    cb({ shiftSession: { updateMany } }),
  )
  return { findUnique, findFirst, updateMany, shiftFindFirst, auditLogCreate, transaction }
})

vi.mock('@/lib/db/client', () => ({
  db: {
    shiftSession: {
      findUnique: mocks.findUnique,
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
    shift: { findFirst: mocks.shiftFindFirst },
    auditLog: { create: mocks.auditLogCreate },
    $transaction: mocks.transaction,
  },
}))

const { findUnique, findFirst, updateMany, shiftFindFirst, auditLogCreate, transaction } = mocks

import { tryAutoApproveHandover } from '@/lib/shifts/autoApprove'

const baseIn = {
  id: 'in-1',
  userId: 'u-in',
  status: 'PENDING_START',
  shiftNumber: 'TWO',
  handoverFromUserId: 'u-out',
  notes: null,
  startAt: new Date('2026-05-11T12:00:00Z'),
  wallets: [{ accountId: 'w1' }, { accountId: 'w2' }],
}
const baseOut = {
  id: 'out-1',
  userId: 'u-out',
  status: 'PENDING_END',
  shiftNumber: 'ONE',
  handoverFromUserId: null,
  notes: null,
  startAt: new Date('2026-05-11T04:00:00Z'),
  wallets: [{ accountId: 'w1' }, { accountId: 'w2' }],
}

beforeEach(() => {
  findUnique.mockReset()
  findFirst.mockReset()
  updateMany.mockReset()
  shiftFindFirst.mockReset()
  auditLogCreate.mockReset()
  transaction.mockClear()
})

describe('tryAutoApproveHandover — incoming trigger', () => {
  it('approves when both sides exist + wallets match + scheduled', async () => {
    findUnique.mockResolvedValueOnce(baseIn)          // load incoming
    findFirst.mockResolvedValueOnce(baseOut)          // load outgoing (by user)
    shiftFindFirst.mockResolvedValueOnce({ id: 'sh', userId: 'u-in' }) // scheduled
    updateMany.mockResolvedValue({ count: 1 })        // both flips succeed
    auditLogCreate.mockResolvedValue({})

    const r = await tryAutoApproveHandover({ incomingSessionId: 'in-1' })
    expect(r.approved).toBe(true)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(auditLogCreate).toHaveBeenCalledTimes(1)
    const auditArgs = auditLogCreate.mock.calls[0][0]
    expect(auditArgs.data.action).toBe('AUTO_APPROVE_HANDOVER')
    expect(auditArgs.data.details.triggeredBy).toBe('incoming')
  })

  it('rejects with waiting message when no outgoing PENDING_END yet', async () => {
    findUnique.mockResolvedValueOnce(baseIn)
    findFirst.mockResolvedValueOnce(null) // no outgoing yet
    const r = await tryAutoApproveHandover({ incomingSessionId: 'in-1' })
    expect(r.approved).toBe(false)
    expect(r.reason).toMatch(/في انتظار تسجيل خروج/)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('rejects when wallet sets differ', async () => {
    findUnique.mockResolvedValueOnce(baseIn)
    findFirst.mockResolvedValueOnce({
      ...baseOut,
      wallets: [{ accountId: 'w1' }, { accountId: 'w-different' }],
    })
    const r = await tryAutoApproveHandover({ incomingSessionId: 'in-1' })
    expect(r.approved).toBe(false)
    expect(r.reason).toMatch(/لا تطابق/)
  })
})

describe('tryAutoApproveHandover — outgoing trigger', () => {
  it('approves when triggered by outgoing after incoming has already checked in', async () => {
    findUnique.mockResolvedValueOnce(baseOut)         // load outgoing
    findFirst.mockResolvedValueOnce(baseIn)           // load matching incoming
    shiftFindFirst.mockResolvedValueOnce({ id: 'sh', userId: 'u-in' })
    updateMany.mockResolvedValue({ count: 1 })
    auditLogCreate.mockResolvedValue({})

    const r = await tryAutoApproveHandover({ outgoingSessionId: 'out-1' })
    expect(r.approved).toBe(true)
    const auditArgs = auditLogCreate.mock.calls[0][0]
    expect(auditArgs.data.details.triggeredBy).toBe('outgoing')
  })

  it('rejects with waiting message when no incoming PENDING_START exists yet', async () => {
    findUnique.mockResolvedValueOnce(baseOut)
    findFirst.mockResolvedValueOnce(null) // no incoming yet
    const r = await tryAutoApproveHandover({ outgoingSessionId: 'out-1' })
    expect(r.approved).toBe(false)
    expect(r.reason).toMatch(/في انتظار تسجيل دخول/)
  })

  it('rejects when outgoing session is no longer PENDING_END', async () => {
    findUnique.mockResolvedValueOnce({ ...baseOut, status: 'COMPLETED' })
    const r = await tryAutoApproveHandover({ outgoingSessionId: 'out-1' })
    expect(r.approved).toBe(false)
    expect(r.reason).toMatch(/الإغلاق/)
  })
})

describe('tryAutoApproveHandover — race safety', () => {
  it('returns false with race reason when updateMany.count is 0', async () => {
    findUnique.mockResolvedValueOnce(baseIn)
    findFirst.mockResolvedValueOnce(baseOut)
    shiftFindFirst.mockResolvedValueOnce({ id: 'sh' })
    // First updateMany inside the transaction reports 0 rows updated
    // (another caller flipped first).
    updateMany.mockResolvedValueOnce({ count: 0 })
    const r = await tryAutoApproveHandover({ incomingSessionId: 'in-1' })
    expect(r.approved).toBe(false)
    expect(r.reason).toMatch(/تعارض متزامن/)
  })
})
