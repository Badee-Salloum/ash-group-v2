import { describe, expect, it } from 'vitest'
import { planReceiveRepair, type ReceiveRepairRow } from '@/lib/reconciliation/receiveLabelRepair'

const sc: ReceiveRepairRow = {
  id: 's', accountId: 'a', batchId: 'b', source: 'SHAM_CASH', type: 'WITHDRAWAL', status: 'PENDING_SC',
  amount: '0.00', currency: 'USD', shamCashTxId: 'SC', platformTxId: null, platformUserId: null,
  matchedTxId: null, reviewCategory: null, amountDiff: null,
  rawData: { txId: 'SC', type: 'WITHDRAWAL', receivedAmount: 2, sentAmount: 0 },
  notes: 'internal-transfer', isInternalTransferAuto: true,
}
const p: ReceiveRepairRow = { ...sc, id: 'p', source: 'PLATFORM', type: 'DEPOSIT', status: 'PENDING_P',
  amount: '2.00', platformTxId: 'P', platformUserId: 'U', rawData: { txId: 'P', amount: 2 }, notes: null }

describe('retrospective receive-label repair safety', () => {
  it('uses source received amount, fixes direction, and is idempotent', () => {
    const [patch] = planReceiveRepair(sc)
    expect(patch).toMatchObject({ type: 'DEPOSIT', amount: '2.00', status: 'PENDING_SC', isInternalTransferAuto: true })
    expect(patch.rawData.type).toBe('DEPOSIT')
    expect(() => planReceiveRepair({ ...sc, ...patch })).toThrow()
  })
  it('recovers an exact same-batch pending platform reference', () => {
    const patches = planReceiveRepair(sc, p)
    expect(patches[0]).toMatchObject({ matchedTxId: 'p', status: 'MATCHED', notes: null, isInternalTransferAuto: false })
    expect(patches[1]).toMatchObject({ matchedTxId: 's', status: 'MATCHED' })
  })
  it('preserves both old records and charges a discrepancy only to the higher side', () => {
    const patches = planReceiveRepair({ ...sc, matchedTxId: 'p', status: 'MATCHED' },
      { ...p, matchedTxId: 's', status: 'MATCHED', amount: '5.00' })
    expect(patches).toHaveLength(2)
    expect(patches[0]).toMatchObject({ amount: '2.00', status: 'DISCREPANCY', amountDiff: '0.00' })
    expect(patches[1]).toMatchObject({ amount: '5.00', status: 'DISCREPANCY', amountDiff: '3.00' })
  })
  it.each([
    { currency: 'SYP' }, { matchedTxId: 'other' }, { accountId: 'other' }, { reviewCategory: 'EMPLOYEE_ERROR' },
    { batchId: 'other' }, { source: 'SHAM_CASH' }, { type: 'WITHDRAWAL' },
  ])('refuses unsafe partner %o', changes => {
    expect(() => planReceiveRepair(sc, { ...p, ...changes })).toThrow()
  })
  it('refuses to override a manually reviewed source', () => {
    expect(() => planReceiveRepair({ ...sc, reviewCategory: 'OTHER' })).toThrow()
  })
  it('never substitutes the platform amount for invalid original evidence', () => {
    expect(() => planReceiveRepair({ ...sc, rawData: { ...sc.rawData, txId: 'wrong' } }, p)).toThrow()
  })
})
