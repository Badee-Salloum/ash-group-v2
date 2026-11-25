import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), inbound: vi.fn(), journal: vi.fn(), run: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: { $transaction: m.run } }))
import { AutoMatchConflict, assertDisjointPairs, linkAutomaticPairs } from '@/lib/reconciliation/autoLink'
import { withAuditContext } from '@/lib/audit/context'

const sc = () => ({ id: 'sc', accountId: 'a', source: 'SHAM_CASH', type: 'DEPOSIT', currency: 'USD',
  amount: '50.00', status: 'PENDING_SC', matchedTxId: null, amountDiff: null,
  platformTxId: null, platformUserId: 'user', shamCashTxId: 'SC', reviewCategory: null })
const pl = () => ({ ...sc(), id: 'pl', source: 'PLATFORM', status: 'PENDING_P', platformTxId: 'P' })
const tx = { $queryRawUnsafe: m.read, $executeRawUnsafe: m.write, transaction: { findMany: m.inbound }, auditLog: { create: m.journal } }
beforeEach(() => {
  vi.resetAllMocks()
  m.run.mockImplementation(async callback => callback(tx))
  m.read.mockResolvedValue([sc(), pl()]); m.inbound.mockResolvedValue([])
  m.write.mockResolvedValue(2); m.journal.mockResolvedValue({})
})
describe('automatic linking live invariants', () => {
  it('locks in stable order and writes two reciprocal equal-amount links with atomic journal', async () => {
    await withAuditContext({ actorType: 'HUMAN', actorUserId: 'initiator', authMethod: 'SESSION', requestId: 'r', operationId: 'attempt' },
      () => linkAutomaticPairs([['sc', 'pl']], 'HISTORICAL_DEPOSIT'))
    expect(m.read.mock.calls[0][0]).toContain('ORDER BY id FOR UPDATE')
    const changes = JSON.parse(m.write.mock.calls[0][1])
    expect(changes).toEqual([expect.objectContaining({ id: 'sc', matchedTxId: 'pl', status: 'MATCHED', amountDiff: null }),
      expect.objectContaining({ id: 'pl', matchedTxId: 'sc', status: 'MATCHED', amountDiff: null })])
    const entry = m.journal.mock.calls[0][0].data
    expect(entry).toMatchObject({ userId: null, action: 'AUTO_MATCH_PAIRS', entityId: 'attempt',
      details: { actorType: 'SYSTEM', actorUserId: 'initiator', authMethod: 'SESSION', reason: 'automatic_reconciliation' } })
    expect(entry.details.changes[0].before.matchedTxId).toBeNull()
    expect(JSON.stringify(entry)).not.toContain('rawData')
  })
  it.each(['50.01', '49.99', '0.01'])('computes exact cents and never labels unequal amounts MATCHED (%s)', async amount => {
    m.read.mockResolvedValue([sc(), { ...pl(), amount }])
    await linkAutomaticPairs([['sc', 'pl']], 'HISTORICAL_DEPOSIT')
    const changes = JSON.parse(m.write.mock.calls[0][1])
    expect(changes.every((r: { status: string }) => r.status === 'DISCREPANCY')).toBe(true)
    expect(changes[0].matchedTxId).toBe('pl'); expect(changes[1].matchedTxId).toBe('sc')
    expect(Number(changes[0].amountDiff)).toBeCloseTo(Math.abs(50 - Number(amount)), 2)
  })
  it.each([
    { currency: 'SYP' }, { accountId: 'other' }, { type: 'WITHDRAWAL' }, { source: 'SHAM_CASH' },
    { matchedTxId: 'claimed' }, { reviewCategory: 'EMPLOYEE_ERROR' }, { status: 'MATCHED' },
    { shamCashTxId: 'OTHER' }, { amount: '-1' }, { currency: '' },
  ])('rejects changed or ineligible live counterpart: %j', async override => {
    m.read.mockResolvedValue([sc(), { ...pl(), ...override }])
    await expect(linkAutomaticPairs([['sc', 'pl']], 'HISTORICAL_DEPOSIT')).rejects.toBeInstanceOf(AutoMatchConflict)
    expect(m.write).not.toHaveBeenCalled(); expect(m.journal).not.toHaveBeenCalled()
  })
  it('rejects a legacy inbound one-way link rather than stealing its target', async () => {
    m.inbound.mockResolvedValue([{ id: 'legacy' }])
    await expect(linkAutomaticPairs([['sc', 'pl']], 'NEW_BATCH')).rejects.toBeInstanceOf(AutoMatchConflict)
    expect(m.write).not.toHaveBeenCalled()
  })
  it('requires both sides and rejects any shared node before opening a transaction', async () => {
    expect(() => assertDisjointPairs([['a', 'b'], ['c', 'b']])).toThrow(AutoMatchConflict)
    await expect(linkAutomaticPairs([['sc', 'sc']], 'NEW_BATCH')).rejects.toThrow()
    expect(m.run).not.toHaveBeenCalled()
    m.read.mockResolvedValue([sc()])
    await expect(linkAutomaticPairs([['sc', 'pl']], 'NEW_BATCH')).rejects.toThrow()
  })
  it('propagates audit failure through the same transaction (no unjournaled success)', async () => {
    m.journal.mockRejectedValue(new Error('AUDIT_UNAVAILABLE'))
    await expect(linkAutomaticPairs([['sc', 'pl']], 'NEW_BATCH')).rejects.toThrow('AUDIT_UNAVAILABLE')
    expect(m.run).toHaveBeenCalledOnce()
  })
  it('rejects an incomplete bulk update rather than journaling a false success', async () => {
    m.write.mockResolvedValue(1)
    await expect(linkAutomaticPairs([['sc', 'pl']], 'NEW_BATCH')).rejects.toThrow(AutoMatchConflict)
    expect(m.journal).not.toHaveBeenCalled()
  })
  it('does not turn a changed complaint amount into a new inferred match', async () => {
    m.read.mockResolvedValue([sc(), { ...pl(), amount: '51.00', shamCashTxId: null }])
    await expect(linkAutomaticPairs([['sc', 'pl']], 'HISTORICAL_COMPLAINT')).rejects.toThrow()
    expect(m.write).not.toHaveBeenCalled()
  })
})
