import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ findMany: vi.fn(), update: vi.fn(), count: vi.fn(), link: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: { transaction: { findMany: m.findMany, count: m.count }, uploadBatch: { update: m.update } } }))
vi.mock('@/lib/reconciliation/autoLink', () => ({ linkAutomaticPairs: m.link }))
import { dedupAgainstExisting, rollbackBatch } from '@/lib/reconciliation/batchProcessor.persist'
const old = () => ({ id: 'old-sc', source: 'SHAM_CASH', type: 'DEPOSIT', currency: 'USD',
  status: 'PENDING_SC', matchedTxId: null, reviewCategory: null, shamCashTxId: 'SC', platformTxId: null })
const incoming = (): Array<Record<string, unknown>> => [
  { ...old(), id: 'new-sc', status: 'MATCHED' },
  { id: 'new-p', source: 'PLATFORM', type: 'DEPOSIT', currency: 'USD', platformTxId: 'P', status: 'MATCHED' },
]
beforeEach(() => { vi.resetAllMocks(); m.findMany.mockResolvedValue([old()]); m.count.mockResolvedValue(5) })
describe('upload persistence preserves old and new evidence', () => {
  it('reuses an old pending row without deleting or replacing its identity', async () => {
    const records = incoming(); const pairs: Array<[string, string]> = [['new-sc', 'new-p']]
    expect(await dedupAgainstExisting('a', records, pairs)).toBe(1)
    expect(records.map(r => r.id)).toEqual(['new-p']); expect(pairs).toEqual([['old-sc', 'new-p']])
  })
  it.each([{ matchedTxId: 'linked' }, { reviewCategory: 'EMPLOYEE_ERROR' }, { status: 'MATCHED' }])('never reclaims an unavailable row %j', async override => {
    m.findMany.mockResolvedValue([{ ...old(), ...override }])
    const records = incoming(); const pairs: Array<[string, string]> = [['new-sc', 'new-p']]
    await dedupAgainstExisting('a', records, pairs)
    expect(pairs).toEqual([])
    expect(records).toEqual([expect.objectContaining({ id: 'new-p', status: 'PENDING_P' })])
  })
  it('does not choose among duplicate old source identifiers', async () => {
    m.findMany.mockResolvedValue([old(), { ...old(), id: 'old-sc-2' }])
    const records = incoming(); const pairs: Array<[string, string]> = [['new-sc', 'new-p']]
    await dedupAgainstExisting('a', records, pairs)
    expect(pairs).toEqual([]); expect(records[0].status).toBe('PENDING_P')
  })
  it('retains a failed batch with actual committed row count, without deleting audit or financial rows', async () => {
    await rollbackBatch('batch', new Error('secret driver error'))
    expect(m.update).toHaveBeenCalledWith({ where: { id: 'batch' }, data: expect.objectContaining({ status: 'FAILED', rowsProcessed: 5 }) })
    expect(JSON.stringify(m.update.mock.calls)).not.toContain('secret')
  })
})
