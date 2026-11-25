import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: { $transaction: mocks.transaction } }))
import { syncTransactionReadModels } from '@/lib/performance/readModels'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.execute.mockResolvedValue(1)
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
    fn({ $executeRawUnsafe: mocks.execute }))
})

describe('duplicate review incremental refresh', () => {
  it('refreshes both legacy and corrected business dates near midnight', async () => {
    await syncTransactionReadModels([{ accountId: 'a', txDateTime: '2026-09-25T22:30:00Z' }])
    const calls = mocks.execute.mock.calls as unknown[][]
    const cleanup = calls.find(call => String(call[0]).includes('DELETE FROM "financial_daily_summaries"'))!
    expect(cleanup.slice(1)).toEqual([['a'], ['2026-09-26', '2026-09-25']])
    const insert = calls.find(call => String(call[0]).includes('INSERT INTO "financial_daily_summaries"'))!
    expect(String(insert[0])).toContain('AT TIME ZONE \'UTC\'')
    expect(String(insert[0])).not.toContain("timezone('Asia/Damascus',")
  })
  it('rebuilds old and new number groups and preserves currency anomalies in reviewed statuses', async () => {
    await syncTransactionReadModels([
      { accountId: 'account-1', shamCashTxId: 'OLD', txDateTime: '2026-09-25T17:30:26Z' },
      { accountId: 'account-1', shamCashTxId: 'NEW', txDateTime: '2026-09-25T17:30:26Z' },
    ])
    const calls = mocks.execute.mock.calls as unknown[][]
    const insert = calls.find(call => String(call[0]).includes('INSERT INTO "duplicate_sc_groups"'))!
    const cleanup = calls.find(call => String(call[0]).includes('DELETE FROM "duplicate_sc_groups"'))!
    expect(cleanup.slice(1)).toEqual([['account-1'], ['OLD', 'NEW']])
    expect(insert.slice(1)).toEqual([['account-1'], ['OLD', 'NEW']])
    // Status restricts only true duplicate pair counts, not currency detection.
    expect(String(insert[0])).toContain("FILTER (WHERE t.status IN ('MATCHED', 'DISCREPANCY'))")
    expect(String(insert[0])).toContain('LEFT JOIN "transactions" m ON m.id = t."matchedTxId"')
    expect(String(insert[0])).toContain('upper(btrim(t.currency)) <> upper(btrim(m.currency))')
    expect(String(insert[0])).toContain('"hasCurrencyMismatch" = EXCLUDED."hasCurrencyMismatch"')
    expect(calls.indexOf(cleanup)).toBeLessThan(calls.indexOf(insert))
  })
})
