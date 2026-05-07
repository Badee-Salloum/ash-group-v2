import { describe, it, expect, vi, beforeEach } from 'vitest'

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    transaction: {
      findMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(async () => ({ rawData: null })),
    },
    customer: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(async (ops: unknown[]) => {
      // Execute the array of update operations
      await Promise.all(ops as Promise<unknown>[])
    }),
  },
}))

vi.mock('@/lib/db/client', () => ({ db: dbMock }))

import { applyHistoricalPlatformOnlyMatches } from '@/lib/reconciliation/batchProcessor.historical'

describe('applyHistoricalPlatformOnlyMatches — link old PENDING_P to new SC', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 0 when no SC TX IDs given', async () => {
    const r = await applyHistoricalPlatformOnlyMatches('acc1', [])
    expect(r.updated).toBe(0)
    expect(dbMock.transaction.findMany).not.toHaveBeenCalled()
  })

  it('links old PENDING_P platform to new SC when amounts match → MATCHED', async () => {
    dbMock.transaction.findMany
      .mockResolvedValueOnce([
        { id: 'sc-new', shamCashTxId: '199793455', status: 'PENDING_SC', amount: 2, currency: 'USD' },
      ])
      .mockResolvedValueOnce([
        { id: 'plat-old', shamCashTxId: '199793455', amount: 2, currency: 'USD' },
      ])
    dbMock.transaction.update.mockResolvedValue({})

    const r = await applyHistoricalPlatformOnlyMatches('acc1', ['199793455'])
    expect(r.updated).toBe(1)

    // Verify both sides got updated to MATCHED + linked
    const calls = dbMock.transaction.update.mock.calls
    expect(calls.length).toBe(2)
    const statuses = calls.map(c => (c[0] as { data: { status: string } }).data.status)
    expect(statuses).toEqual(['MATCHED', 'MATCHED'])
  })

  it('amount mismatch → DISCREPANCY (not MATCHED)', async () => {
    dbMock.transaction.findMany
      .mockResolvedValueOnce([
        { id: 'sc-new', shamCashTxId: '199650168', status: 'PENDING_SC', amount: 30, currency: 'USD' },
      ])
      .mockResolvedValueOnce([
        { id: 'plat-old', shamCashTxId: '199650168', amount: 50, currency: 'USD' },
      ])
    dbMock.transaction.update.mockResolvedValue({})

    const r = await applyHistoricalPlatformOnlyMatches('acc1', ['199650168'])
    expect(r.updated).toBe(1)
    const statuses = dbMock.transaction.update.mock.calls.map(c => (c[0] as { data: { status: string } }).data.status)
    expect(statuses).toEqual(['DISCREPANCY', 'DISCREPANCY'])
    // amountDiff should be set
    const amountDiffs = dbMock.transaction.update.mock.calls.map(c => (c[0] as { data: { amountDiff?: number } }).data.amountDiff)
    expect(amountDiffs).toEqual([20, 20])
  })

  it('no match when shamCashTxId differs', async () => {
    dbMock.transaction.findMany
      .mockResolvedValueOnce([
        { id: 'sc-new', shamCashTxId: '199793455', status: 'PENDING_SC', amount: 2, currency: 'USD' },
      ])
      .mockResolvedValueOnce([])  // no platform with that shamCashTxId
    const r = await applyHistoricalPlatformOnlyMatches('acc1', ['199793455'])
    expect(r.updated).toBe(0)
    expect(dbMock.transaction.update).not.toHaveBeenCalled()
  })

  it('skips platform rows with null shamCashTxId', async () => {
    dbMock.transaction.findMany
      .mockResolvedValueOnce([
        { id: 'sc-new', shamCashTxId: '199793455', status: 'PENDING_SC', amount: 2, currency: 'USD' },
      ])
      .mockResolvedValueOnce([
        { id: 'plat-bad', shamCashTxId: null, amount: 2, currency: 'USD' },
      ])
    const r = await applyHistoricalPlatformOnlyMatches('acc1', ['199793455'])
    expect(r.updated).toBe(0)
  })
})
