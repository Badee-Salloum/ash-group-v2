import { describe, it, expect, vi, beforeEach } from 'vitest'

// Atomic-handover invariants. We mock Prisma's $transaction + updateMany to
// simulate concurrent approvals, ensuring only one wins.

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    shiftSession: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
      await cb(dbMock)
    }),
  },
}))

vi.mock('@/lib/db/client', () => ({ db: dbMock }))

// Replicate the core logic from /api/shifts/sessions PATCH approveHandover
// — keeps test focused on the atomic-flip behaviour without HTTP plumbing.
async function attemptApproveHandover(sessionId: string, outgoingUserId: string | null) {
  return await dbMock.$transaction(async (txArg: unknown) => {
    const tx = txArg as typeof dbMock
    const flipIncoming = await tx.shiftSession.updateMany({
      where: { id: sessionId, status: 'PENDING_START' },
      data: { status: 'ACTIVE' },
    })
    if (flipIncoming.count === 0) {
      throw new Error('الجلسة لم تعد بانتظار الموافقة')
    }
    if (outgoingUserId) {
      const outgoing = await tx.shiftSession.findFirst({
        where: { userId: outgoingUserId, status: 'PENDING_END' },
      })
      if (outgoing) {
        await tx.shiftSession.updateMany({
          where: { id: outgoing.id, status: 'PENDING_END' },
          data: { status: 'COMPLETED' },
        })
      }
    }
  })
}

describe('approveHandover — atomic with status guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flips PENDING_START → ACTIVE on successful update', async () => {
    dbMock.shiftSession.updateMany.mockResolvedValue({ count: 1 })
    dbMock.shiftSession.findFirst.mockResolvedValue(null)
    await expect(attemptApproveHandover('s1', null)).resolves.toBeUndefined()
    expect(dbMock.shiftSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', status: 'PENDING_START' },
        data: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    )
  })

  it('throws when updateMany returns count=0 (race lost / wrong status)', async () => {
    dbMock.shiftSession.updateMany.mockResolvedValue({ count: 0 })
    await expect(attemptApproveHandover('s2', null)).rejects.toThrow(/لم تعد بانتظار الموافقة/)
  })

  it('also closes outgoing PENDING_END session when handoverFromUserId set', async () => {
    dbMock.shiftSession.updateMany
      .mockResolvedValueOnce({ count: 1 })  // incoming flip
      .mockResolvedValueOnce({ count: 1 })  // outgoing flip
    dbMock.shiftSession.findFirst.mockResolvedValue({ id: 'sess-out', userId: 'u-out' })

    await attemptApproveHandover('s3', 'u-out')

    expect(dbMock.shiftSession.updateMany).toHaveBeenCalledTimes(2)
    const secondCall = dbMock.shiftSession.updateMany.mock.calls[1][0] as { data: { status: string } }
    expect(secondCall.data.status).toBe('COMPLETED')
  })

  it('simulates concurrent approvals: only first wins', async () => {
    // First call: incoming flip succeeds
    // Second concurrent call: incoming flip returns 0 (already ACTIVE) → throws
    dbMock.shiftSession.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
    dbMock.shiftSession.findFirst.mockResolvedValue(null)

    await expect(attemptApproveHandover('s4', null)).resolves.toBeUndefined()
    await expect(attemptApproveHandover('s4', null)).rejects.toThrow()
  })
})
