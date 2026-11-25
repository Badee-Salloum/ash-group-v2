import { describe, it, expect, vi, beforeEach } from 'vitest'

const { dbMock, link } = vi.hoisted(() => ({
  link: vi.fn(),
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
vi.mock('@/lib/reconciliation/autoLink', () => ({ linkAutomaticPairs: link, AutoMatchConflict: class extends Error {} }))

import { applyHistoricalPlatformOnlyMatches } from '@/lib/reconciliation/batchProcessor.historical'

describe('applyHistoricalPlatformOnlyMatches — link old PENDING_P to new SC', () => {
  beforeEach(() => { vi.clearAllMocks(); dbMock.transaction.findMany.mockResolvedValue([]) })

  it('rejects the 140 SYP / 140 USD regression without any writes', async () => {
    dbMock.transaction.findMany.mockResolvedValueOnce([
      { id: 'sc', shamCashTxId: '476153071', status: 'PENDING_SC', amount: 140, currency: 'SYP' },
    ]).mockResolvedValueOnce([
      { id: 'p', shamCashTxId: '476153071', amount: 140, currency: 'USD' },
    ])
    expect((await applyHistoricalPlatformOnlyMatches('acc1', ['476153071'])).updated).toBe(0)
    expect(dbMock.transaction.update).not.toHaveBeenCalled()
  })

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

    expect(link).toHaveBeenCalledWith([['sc-new', 'plat-old']], 'HISTORICAL_DEPOSIT')
    // Statuses are calculated from locked live amounts in autoLink tests.
    expect(dbMock.transaction.update).not.toHaveBeenCalled()
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
    expect(link).toHaveBeenCalledWith([['sc-new', 'plat-old']], 'HISTORICAL_DEPOSIT')
    expect(dbMock.transaction.update).not.toHaveBeenCalled()
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
