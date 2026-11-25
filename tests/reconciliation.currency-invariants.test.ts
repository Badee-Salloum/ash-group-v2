import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformDepositRow, PlatformWithdrawalRow } from '@/types'
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn(),
  transaction: vi.fn(), access: vi.fn(), audit: vi.fn(), sync: vi.fn(), invalidate: vi.fn(),
}))
vi.mock('@/lib/db/client', () => ({ db: {
  transaction: { findMany: mocks.findMany, findUnique: mocks.findUnique, findFirst: mocks.findFirst, update: mocks.update, create: mocks.create },
  accountAccess: { findFirst: mocks.access }, $transaction: mocks.transaction,
} }))
vi.mock('@/lib/auth', () => ({ audit: mocks.audit }))
vi.mock('@/lib/reconciliation/customerNames', () => ({ upsertCustomerNamesFromBatch: vi.fn() }))
vi.mock('@/lib/performance/readModels', () => ({ syncTransactionReadModels: mocks.sync }))
vi.mock('@/lib/performance/cache', () => ({ invalidateFinancialReadModels: mocks.invalidate }))
import { runDepositStep } from '@/lib/reconciliation/batchProcessor.deposits'
import { applyHistoricalScIdMatches, applyResolvedComplaints, applyHistoricalWithdrawalScIdMatches, applyHistoricalWithdrawalPlatformOnlyMatches } from '@/lib/reconciliation/batchProcessor.historical'
import { resolveHistoricalComplaints } from '@/lib/reconciliation/deposits'
import { resolveManualPair } from '@/lib/reconciliation/manualResolve'

const platform = {
  txId: 'p', userId: 'u', amount: 140, currency: 'USD', status: 'OK', bankName: '', provider: '',
  createdAt: new Date(), depositTime: new Date(), userInfo: '', shamCashTxId: 'SC', admin: '',
} as PlatformDepositRow
beforeEach(() => { vi.resetAllMocks() })

describe('currency protection in every historical matching direction', () => {
  it('leaves fresh platform deposits pending when old SC uses another currency', async () => {
    mocks.findMany.mockResolvedValueOnce([{ id: 'sc', shamCashTxId: 'SC', amount: 140, currency: 'SYP' }])
    const result = await runDepositStep('a', 'b', [], [platform], [])
    expect(result.historicalMatchesByScTxId).toEqual([])
    expect(result.records[0].status).toBe('PENDING_P')
  })
  it('rechecks old SC currency immediately before persisting a historical match', async () => {
    mocks.findUnique.mockResolvedValueOnce({ id: 'sc', accountId: 'a', status: 'PENDING_SC', currency: 'SYP' })
    expect(await applyHistoricalScIdMatches('a', 'b', [{ pendingTxId: 'sc', pendingAmount: 140, platformRow: platform, matchType: 'MATCHED', diff: 0 }]))
      .toEqual({ resolved: 0, discrepancy: 0 })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('does not settle complaints by equal user/amount when currencies differ', async () => {
    expect(resolveHistoricalComplaints([{ id: 'sc', platformUserId: 'u', amount: 140, currency: 'SYP', txDateTime: new Date() }],
      [{ ...platform, shamCashTxId: null }])).toEqual([])
    mocks.findUnique.mockResolvedValueOnce({ id: 'sc', accountId: 'a', status: 'PENDING_SC', currency: 'SYP' })
    await applyResolvedComplaints('a', 'b', [{ pendingTxId: 'sc', platformRow: platform }])
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it.each(['platform-first', 'sc-first'])('rejects cross-currency withdrawal history: %s', async direction => {
    const sc = { id: 'sc', shamCashTxId: 'SC', amount: 140, currency: 'SYP', matchedTxId: null }
    const p = { id: 'p', shamCashTxId: 'SC', amount: 140, currency: 'USD' }
    mocks.findMany.mockResolvedValueOnce(direction === 'platform-first' ? [sc] : [p])
      .mockResolvedValueOnce(direction === 'platform-first' ? [p] : [sc])
    const result = direction === 'platform-first'
      ? await applyHistoricalWithdrawalPlatformOnlyMatches('a', ['SC'])
      : await applyHistoricalWithdrawalScIdMatches('a', [{ ...platform, withdrawalTime: new Date() } as unknown as PlatformWithdrawalRow])
    expect(result.updated).toBe(0)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe('manual resolution guards', () => {
  it.each(['DEPOSIT', 'WITHDRAWAL'] as const)('blocks mixed currencies in manual %s', async type => {
    mocks.findFirst.mockResolvedValueOnce({ id: 'p', accountId: 'a', currency: 'USD', amount: 140 })
      .mockResolvedValueOnce({ id: 'sc', accountId: 'a', currency: 'SYP', amount: 140 })
    expect((await resolveManualPair('p', 'SC', type, { userId: 'admin', role: 'ADMIN' })).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('preserves amount discrepancies instead of falsely declaring an exact match', async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: 'p', accountId: 'a', currency: 'USD', amount: 150 })
      .mockResolvedValueOnce({ id: 'sc', accountId: 'a', currency: 'USD', amount: 140 })
    const result = await resolveManualPair('p', 'SC', 'DEPOSIT', { userId: 'admin', role: 'ADMIN' })
    expect(result.status).toBe(200)
    expect(result.body.data).toMatchObject({ status: 'DISCREPANCY', amountDiff: 10 })
    expect(mocks.sync).toHaveBeenCalledOnce()
  })
  it('rejects a denied account-manager scope before finding a counterpart', async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: 'p', accountId: 'denied' })
    mocks.access.mockResolvedValueOnce(null)
    expect((await resolveManualPair('p', 'SC', 'DEPOSIT', { userId: 'mgr', role: 'ACCOUNT_MGR' })).status).toBe(403)
    expect(mocks.findFirst).toHaveBeenCalledTimes(1)
  })
})
