import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the db client — every helper under test only touches db.transaction.
const mocks = vi.hoisted(() => ({
  link: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  transactionRun: vi.fn(async (ops: unknown[]) => ops),
}))

vi.mock('@/lib/db/client', () => ({
  db: {
    transaction: {
      findMany: mocks.findMany,
      update: mocks.update,
    },
    $transaction: mocks.transactionRun,
  },
}))
vi.mock('@/lib/reconciliation/autoLink', () => ({ linkAutomaticPairs: mocks.link, AutoMatchConflict: class extends Error {} }))

// Silence upsertCustomerNamesFromBatch import — it isn't called by the two
// helpers under test but batchProcessor.historical.ts imports it at the top.
vi.mock('@/lib/reconciliation/customerNames', () => ({
  upsertCustomerNamesFromBatch: vi.fn(),
}))

const { findMany, update, transactionRun } = mocks

import {
  applyHistoricalWithdrawalScIdMatches,
  applyHistoricalWithdrawalPlatformOnlyMatches,
} from '@/lib/reconciliation/batchProcessor.historical'
import type { PlatformWithdrawalRow } from '@/types'

function platRow(overrides: Partial<PlatformWithdrawalRow>): PlatformWithdrawalRow {
  return {
    txId: 'p-1', userId: 'u-1', amount: 100, currency: 'USD', status: 'OK',
    withdrawalTime: new Date('2026-08-31T20:00:00Z'),
    payoutTime: new Date('2026-08-31T20:01:00Z'),
    userInfo: '', bankName: '', provider: '', payoutConfirmation: '',
    shamCashTxId: null,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.link.mockReset()
  findMany.mockReset()
  update.mockReset()
  transactionRun.mockReset()
  transactionRun.mockImplementation(async (ops: unknown[]) => ops)
})

describe('applyHistoricalWithdrawalScIdMatches', () => {
  it('links fresh Platform WITHDRAWAL to old PENDING_SC WITHDRAWAL by shamCashTxId', async () => {
    // Fresh platform DB row (already inserted)
    findMany
      .mockResolvedValueOnce([
        { id: 'plat-db-1', shamCashTxId: 'SC-100', amount: 50, currency: 'USD', platformUserId: 'u-9' },
      ])
      // Old PENDING_SC row
      .mockResolvedValueOnce([
        { id: 'sc-db-1', shamCashTxId: 'SC-100', amount: 50, currency: 'USD' },
      ])

    const res = await applyHistoricalWithdrawalScIdMatches('acc-1', [
      platRow({ shamCashTxId: 'SC-100', amount: 50 }),
    ])

    expect(res.updated).toBe(1)
    expect(mocks.link).toHaveBeenCalledWith([['plat-db-1', 'sc-db-1']], 'HISTORICAL_WITHDRAWAL')
  })

  it('marks pair as DISCREPANCY when amounts differ beyond tolerance', async () => {
    findMany
      .mockResolvedValueOnce([
        { id: 'plat-1', shamCashTxId: 'SC-200', amount: 45, currency: 'USD', platformUserId: 'u-1' },
      ])
      .mockResolvedValueOnce([
        { id: 'sc-1', shamCashTxId: 'SC-200', amount: 50, currency: 'USD' },
      ])
    // Track update() calls made inside the $transaction batch. Prisma's real
    // $transaction([...]) receives PromiseLike operations, so our stub can't
    // introspect the data payload — spy on the underlying update() instead.
    update.mockResolvedValue({})

    await applyHistoricalWithdrawalScIdMatches('acc-1', [
      platRow({ shamCashTxId: 'SC-200', amount: 45 }),
    ])

    expect(mocks.link).toHaveBeenCalledWith([['plat-1', 'sc-1']], 'HISTORICAL_WITHDRAWAL')
    expect(update).not.toHaveBeenCalled()
  })

  it('returns 0 when no fresh platform rows carry a shamCashTxId', async () => {
    const res = await applyHistoricalWithdrawalScIdMatches('acc-1', [
      platRow({ shamCashTxId: null }),
      platRow({ shamCashTxId: undefined }),
    ])
    expect(res.updated).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe('applyHistoricalWithdrawalPlatformOnlyMatches', () => {
  it('links fresh SC WITHDRAWAL to old PENDING_P WITHDRAWAL by shamCashTxId', async () => {
    findMany
      // Fresh SC rows in this account
      .mockResolvedValueOnce([
        { id: 'sc-db-1', shamCashTxId: 'SC-300', amount: 25, currency: 'USD', status: 'PENDING_SC', matchedTxId: null },
      ])
      // Old PENDING_P platform rows
      .mockResolvedValueOnce([
        { id: 'plat-db-1', shamCashTxId: 'SC-300', amount: 25, currency: 'USD', platformUserId: 'u-2' },
      ])

    const res = await applyHistoricalWithdrawalPlatformOnlyMatches('acc-1', ['SC-300'])

    expect(res.updated).toBe(1)
    expect(mocks.link).toHaveBeenCalledWith([['sc-db-1', 'plat-db-1']], 'HISTORICAL_WITHDRAWAL')
  })

  it('skips fresh SC rows that are already matched', async () => {
    findMany
      .mockResolvedValueOnce([
        { id: 'sc-db-1', shamCashTxId: 'SC-400', amount: 25, currency: 'USD', status: 'MATCHED', matchedTxId: 'p-9' },
      ])
      .mockResolvedValueOnce([
        { id: 'plat-db-1', shamCashTxId: 'SC-400', amount: 25, currency: 'USD', platformUserId: 'u-3' },
      ])

    const res = await applyHistoricalWithdrawalPlatformOnlyMatches('acc-1', ['SC-400'])
    expect(res.updated).toBe(0)
  })

  it('returns 0 on empty input without touching the DB', async () => {
    const res = await applyHistoricalWithdrawalPlatformOnlyMatches('acc-1', [])
    expect(res.updated).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})
