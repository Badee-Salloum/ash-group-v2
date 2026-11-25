import { describe, expect, it } from 'vitest'
import type { PlatformDepositRow, ShamCashRow } from '@/types'
import { runWithdrawalStep } from '@/lib/reconciliation/batchProcessor.withdrawals'

function run(scAmount: number, platformAmount: number) {
  const sc: ShamCashRow = { txId: 'SC', type: 'WITHDRAWAL', sentAmount: scAmount, receivedAmount: 0,
    currency: 'USD', date: '2026-10-12', time: '12:00:00', txDateTime: new Date('2026-10-12T09:00:00Z'),
    accountName: 'customer', accountNumber: '', notes: '' }
  const p: PlatformDepositRow = { txId: 'P', userId: 'U', amount: platformAmount, currency: 'USD',
    shamCashTxId: 'SC', createdAt: sc.txDateTime, depositTime: sc.txDateTime, userInfo: '', status: 'OK',
    provider: '', bankName: '', admin: '' }
  return runWithdrawalStep('account', 'batch', [sc], [], [p], [], new Set(), new Set())
}

describe('cross-deposit persistence', () => {
  it.each([[2, 5, 'PLATFORM'], [5, 2, 'SHAM_CASH']])('preserves the %s versus %s discrepancy on the higher side', (scAmount, pAmount, source) => {
    const result = run(Number(scAmount), Number(pAmount))
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({ source, type: 'DEPOSIT', status: 'DISCREPANCY', amount: 5, amountDiff: 3 })
    expect(result.records[0].rawData).toMatchObject({ sc: { sentAmount: scAmount }, platform: { amount: pAmount } })
    expect(result.matchedPairs).toEqual([])
    expect(result.finalUnmatchedSCSends).toEqual([])
  })
  it('creates two reciprocal candidates only for equal amounts', () => {
    const result = run(10, 10)
    expect(result.records).toHaveLength(2)
    expect(result.records.every(row => row.status === 'MATCHED' && row.amount === 10)).toBe(true)
    expect(result.matchedPairs).toHaveLength(1)
  })
})
