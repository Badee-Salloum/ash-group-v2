import { describe, it, expect } from 'vitest'
import { reconcileDeposits } from '@/lib/reconciliation/deposits'
import type { ShamCashRow, PlatformDepositRow } from '@/types'

function sc(over: Partial<ShamCashRow>): ShamCashRow {
  return {
    txId: 'SC1',
    type: 'DEPOSIT',
    receivedAmount: 100,
    sentAmount: 0,
    currency: 'USD',
    date: '2026-04-28',
    time: '23:10:27',
    txDateTime: new Date('2026-04-28T23:10:27+03:00'),
    accountNumber: '************1717',
    accountName: 'محمود احمد الصالح',
    notes: '',
    ...over,
  }
}

function pl(over: Partial<PlatformDepositRow>): PlatformDepositRow {
  return {
    txId: 'P1',
    amount: 100,
    currency: 'USD',
    depositTime: new Date('2026-04-28T23:11:11+03:00'),
    createdAt: new Date('2026-04-28T23:10:27+03:00'),
    userId: 'U1',
    status: 'OK',
    bankName: '',
    provider: '',
    userInfo: '',
    admin: '',
    shamCashTxId: 'SC1',
    ...over,
  } as unknown as PlatformDepositRow
}

describe('reconcileDeposits — TX ID matching', () => {
  it('matches deposit by SC TX ID', () => {
    const r = reconcileDeposits(
      [sc({ txId: '199793455', receivedAmount: 2 })],
      [pl({ txId: 'P_REAL', amount: 2, shamCashTxId: '199793455' })],
    )
    expect(r.matched.length).toBe(1)
    expect(r.platformOnly.length).toBe(0)
  })

  it('REGRESSION: SC deposit that LOOKS internal but has a real platform partner is matched', () => {
    // The bug: walletIdentifiers heuristic excluded the SC row before TX-ID
    // matching, so the platform partner ended up as "platform only".
    const r = reconcileDeposits(
      [sc({ txId: '199793455', accountName: 'محمود احمد الصالح', receivedAmount: 2 })],
      [pl({ txId: 'P_REAL', amount: 2, shamCashTxId: '199793455' })],
      ['محمود احمد'],  // wallet identifier overlaps with customer name (false positive)
    )
    expect(r.matched.length, 'should match by TX ID').toBe(1)
    expect(r.platformOnly.length, 'no platform-only stragglers').toBe(0)
    expect(r.internalTransfers.length, 'NOT marked internal').toBe(0)
    expect(r.shamCashOnly.length).toBe(0)
  })

  it('SC deposit with wallet-id match AND no platform partner → internalTransfers', () => {
    const r = reconcileDeposits(
      [sc({ txId: 'I1', accountName: 'محفظة فرع داخلي', receivedAmount: 50 })],
      [],
      ['محفظة فرع'],
    )
    expect(r.internalTransfers.length).toBe(1)
    expect(r.shamCashOnly.length).toBe(0)
  })

  it('SC deposit external (no wallet match) AND no platform → shamCashOnly', () => {
    const r = reconcileDeposits(
      [sc({ txId: 'X1', accountName: 'زبون عشوائي', receivedAmount: 50 })],
      [],
      ['محفظة فرع'],
    )
    expect(r.shamCashOnly.length).toBe(1)
    expect(r.internalTransfers.length).toBe(0)
  })

  it('discrepancy when SC TX ID matches but amount differs', () => {
    const r = reconcileDeposits(
      [sc({ txId: 'D', receivedAmount: 100 })],
      [pl({ shamCashTxId: 'D', amount: 150 })],
    )
    expect(r.discrepancyPHigher.length).toBe(1)
    expect(r.discrepancyPHigher[0].diff).toBe(50)
    expect(r.matched.length).toBe(0)
  })

  it('currency mismatch leaves both sides unmatched', () => {
    const r = reconcileDeposits(
      [sc({ txId: 'CC', currency: 'USD' })],
      [pl({ shamCashTxId: 'CC', currency: 'EUR' })],
    )
    expect(r.matched.length).toBe(0)
    expect(r.shamCashOnly.length).toBe(1)
    expect(r.platformOnly.length).toBe(1)
  })
})
