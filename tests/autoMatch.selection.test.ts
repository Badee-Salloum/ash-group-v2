import { describe, expect, it } from 'vitest'
import type { ShamCashRow, PlatformDepositRow, PlatformWithdrawalRow } from '@/types'
import { reconcileDeposits, resolveHistoricalComplaints } from '@/lib/reconciliation/deposits'
import { reconcileWithdrawals, crossMatchSendsWithDeposits } from '@/lib/reconciliation/withdrawals'
const date = new Date('2026-10-15T10:00:00Z')
const sc = (type: 'DEPOSIT' | 'WITHDRAWAL' = 'DEPOSIT'): ShamCashRow => ({ txId: 'SC', type, currency: 'USD',
  sentAmount: 50, receivedAmount: 50, accountName: 'customer', accountNumber: '', notes: '', date: '2026-10-15', time: '13:00', txDateTime: date })
const platform = (txId = 'P'): PlatformDepositRow => ({ txId, userId: 'user', amount: 50, currency: 'USD',
  shamCashTxId: 'SC', createdAt: date, depositTime: date, userInfo: '', status: 'OK', bankName: '', provider: '', admin: '' })
const withdrawal = (txId = 'P') => ({ ...platform(txId), withdrawalTime: date, payoutTime: date }) as unknown as PlatformWithdrawalRow
describe('automatic candidates must be unique on both sides', () => {
  it('does not choose the first or last platform deposit referencing the same SC number', () => {
    const result = reconcileDeposits([sc()], [platform('P1'), platform('P2')])
    expect(result.matched).toEqual([]); expect(result.platformOnly).toHaveLength(2); expect(result.shamCashOnly).toHaveLength(1)
  })
  it('does not use a repeated source ID, even if its amounts differ', () => {
    const result = reconcileDeposits([sc()], [platform(), { ...platform(), amount: 60 }])
    expect(result.matched).toEqual([]); expect(result.discrepancyPHigher).toEqual([])
  })
  it('leaves duplicate SC rows pending rather than reusing one partner', () => {
    const result = reconcileDeposits([sc(), sc()], [platform()])
    expect(result.matched).toEqual([]); expect(result.shamCashOnly).toHaveLength(2)
  })
  it('applies the same uniqueness rule to withdrawals and cross-deposits', () => {
    expect(reconcileWithdrawals([sc('WITHDRAWAL')], [withdrawal('P1'), withdrawal('P2')]).matched).toEqual([])
    expect(crossMatchSendsWithDeposits([sc('WITHDRAWAL')], [platform('P1'), platform('P2')], new Set()).crossMatched).toEqual([])
  })
  it('never converts a currency to make numeric equality a match', () => {
    expect(reconcileDeposits([{ ...sc(), currency: 'SYP' }], [platform()]).matched).toEqual([])
  })
  it('keeps unique unequal-amount references as discrepancies', () => {
    const result = reconcileDeposits([sc()], [{ ...platform(), amount: 60 }])
    expect(result.matched).toEqual([]); expect(result.discrepancyPHigher).toHaveLength(1)
  })
  it('does not settle a complaint when either direction has two candidates', () => {
    const pending = { id: 'pending', platformUserId: 'user', amount: 50, currency: 'USD', txDateTime: date }
    const p = { ...platform(), shamCashTxId: null }
    expect(resolveHistoricalComplaints([pending, { ...pending, id: 'pending2' }], [p])).toEqual([])
    expect(resolveHistoricalComplaints([pending], [p, { ...p, txId: 'P2' }])).toEqual([])
    expect(resolveHistoricalComplaints([pending], [p, { ...p, amount: 60 }])).toEqual([])
  })
})
