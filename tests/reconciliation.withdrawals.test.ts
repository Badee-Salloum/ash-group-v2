import { describe, it, expect } from 'vitest'
import { reconcileWithdrawals, crossMatchSendsWithDeposits } from '@/lib/reconciliation/withdrawals'
import type { ShamCashRow, PlatformWithdrawalRow, PlatformDepositRow } from '@/types'

function sc(over: Partial<ShamCashRow>): ShamCashRow {
  return {
    txId: 'SC1',
    type: 'WITHDRAWAL',
    receivedAmount: 0,
    sentAmount: 100,
    currency: 'USD',
    date: '2026-04-24',
    time: '19:24:22',
    txDateTime: new Date('2026-04-24T19:24:22+03:00'),
    accountNumber: '************1462',
    accountName: 'حسان احمد صطوف',
    notes: '',
    ...over,
  }
}

function pl(over: Partial<PlatformWithdrawalRow>): PlatformWithdrawalRow {
  return {
    txId: 'P1',
    amount: 100,
    currency: 'USD',
    payoutTime: new Date('2026-04-24T19:25:13+03:00'),
    withdrawalTime: new Date('2026-04-24T19:14:23+03:00'),
    customerId: 'C1',
    customerName: 'حسان احمد صطوف',
    shamCashTxId: null,
    rawData: {},
    ...over,
  } as PlatformWithdrawalRow
}

describe('reconcileWithdrawals — txId-based matching (Phase 1)', () => {
  it('matches by BankTranferComment txId regardless of time gap', () => {
    // 51-second gap exceeds the old 40s window — should still match via txId
    const r = reconcileWithdrawals(
      [sc({ txId: '194800154', sentAmount: 100 })],
      [pl({ txId: 'PXY', amount: 100, shamCashTxId: '194800154' })],
    )
    expect(r.matched.length).toBe(1)
    expect(r.matched[0].shamCash.txId).toBe('194800154')
    expect(r.shamCashOnly.length).toBe(0)
    expect(r.platformOnly.length).toBe(0)
  })

  it('classifies as DISCREPANCY (P higher) when txId matches but amount differs', () => {
    const r = reconcileWithdrawals(
      [sc({ txId: 'X', sentAmount: 100 })],
      [pl({ shamCashTxId: 'X', amount: 150 })],
    )
    expect(r.matched.length).toBe(0)
    expect(r.discrepancyPHigher.length).toBe(1)
    expect(r.discrepancyPHigher[0].diff).toBe(50)
  })

  it('classifies as DISCREPANCY (SC higher) when txId matches but SC > P', () => {
    const r = reconcileWithdrawals(
      [sc({ txId: 'X', sentAmount: 200 })],
      [pl({ shamCashTxId: 'X', amount: 150 })],
    )
    expect(r.discrepancySCHigher.length).toBe(1)
    expect(r.discrepancySCHigher[0].diff).toBe(50)
  })

  it('skips match if currency mismatch even with same txId', () => {
    const r = reconcileWithdrawals(
      [sc({ txId: 'X', currency: 'USD' })],
      [pl({ shamCashTxId: 'X', currency: 'EUR' })],
    )
    expect(r.matched.length).toBe(0)
    expect(r.shamCashOnly.length).toBe(1)
    expect(r.platformOnly.length).toBe(1)
  })
})

describe('reconcileWithdrawals — Phase 2 (time-based) is DISABLED', () => {
  it('does NOT match a perfect time+amount candidate without txId link', () => {
    // 5-second gap, identical amount — old Phase 2 would match. Now it should NOT.
    const r = reconcileWithdrawals(
      [sc({ txId: 'A', sentAmount: 100, txDateTime: new Date('2026-04-24T19:25:08+03:00') })],
      [pl({ txId: 'P', amount: 100, shamCashTxId: null })],
    )
    expect(r.matched.length).toBe(0)
    expect(r.shamCashOnly.length).toBe(1)
    expect(r.platformOnly.length).toBe(1)
  })

  it('does NOT auto-match even with sub-second gap', () => {
    const r = reconcileWithdrawals(
      [sc({ txId: 'A', sentAmount: 100, txDateTime: new Date('2026-04-24T19:25:13+03:00') })],
      [pl({ txId: 'P', amount: 100, payoutTime: new Date('2026-04-24T19:25:13+03:00'), shamCashTxId: null })],
    )
    expect(r.matched.length).toBe(0)
  })
})

describe('reconcileWithdrawals — internal-transfer filtering', () => {
  it('returns SC sends to own walletIdentifiers in internalTransfers (NOT shamCashOnly)', () => {
    const r = reconcileWithdrawals(
      [sc({ txId: 'I1', accountName: 'محفظة الفرع الرئيسية', sentAmount: 50 })],
      [],
      ['محفظة الفرع'],
    )
    expect(r.matched.length).toBe(0)
    expect(r.shamCashOnly.length).toBe(0)
    expect(r.internalTransfers.length).toBe(1)
    expect(r.internalTransfers[0].txId).toBe('I1')
  })

  it('does not double-count: external SC withdrawal stays in shamCashOnly', () => {
    const r = reconcileWithdrawals(
      [sc({ txId: 'X1', accountName: 'حسان احمد صطوف', sentAmount: 100 })],
      [],
      ['محفظة الفرع'],
    )
    expect(r.shamCashOnly.length).toBe(1)
    expect(r.internalTransfers.length).toBe(0)
  })

  it('REGRESSION: SC row that LOOKS internal but has a real platform partner is matched, NOT marked internal', () => {
    // Bug: previously the heuristic excluded this SC row before TX-ID match,
    // so the platform side ended up as "platform only" even though both
    // sides were the same transaction.
    const r = reconcileWithdrawals(
      [sc({ txId: '199793455', accountName: 'محمود احمد الصالح', sentAmount: 2 })],
      [pl({ txId: 'P_REAL', amount: 2, shamCashTxId: '199793455' })],
      ['محمود احمد'],  // walletIds happens to overlap with the customer name
    )
    expect(r.matched.length, 'should match by TX ID despite name overlap').toBe(1)
    expect(r.matched[0].shamCash.txId).toBe('199793455')
    expect(r.internalTransfers.length).toBe(0)
    expect(r.shamCashOnly.length).toBe(0)
    expect(r.platformOnly.length).toBe(0)
  })
})

describe('crossMatchSendsWithDeposits — TX ID only', () => {
  it('does NOT match by time+amount alone (heuristic disabled)', () => {
    const dep = {
      txId: 'D1', amount: 100, currency: 'USD',
      depositTime: new Date('2026-04-24T19:25:13+03:00'),
      createdAt: new Date('2026-04-24T19:25:13+03:00'),
      customerId: 'C', customerName: 'X', shamCashTxId: null, rawData: {},
    } as unknown as PlatformDepositRow
    const result = crossMatchSendsWithDeposits(
      [sc({ txId: 'S1', sentAmount: 100, txDateTime: new Date('2026-04-24T19:25:13+03:00') })],
      [dep],
      new Set(),
    )
    expect(result.crossMatched.length).toBe(0)
    expect(result.stillUnmatched.length).toBe(1)
  })

  it('DOES match SC ارسال × Platform DEPOSIT when shamCashTxId equals SC TX ID', () => {
    const dep = {
      txId: 'D2', amount: 100, currency: 'USD',
      depositTime: new Date('2026-04-24T19:25:13+03:00'),
      createdAt: new Date('2026-04-24T19:25:13+03:00'),
      customerId: 'C', customerName: 'X', shamCashTxId: '199793455', rawData: {},
    } as unknown as PlatformDepositRow
    const result = crossMatchSendsWithDeposits(
      [sc({ txId: '199793455', sentAmount: 100, currency: 'USD' })],
      [dep],
      new Set(),
    )
    expect(result.crossMatched.length).toBe(1)
    expect(result.crossMatched[0].shamCash.txId).toBe('199793455')
    expect(result.crossMatched[0].platform.txId).toBe('D2')
    expect(result.stillUnmatched.length).toBe(0)
  })

  it('does not match if currency differs even when TX IDs align', () => {
    const dep = {
      txId: 'D3', amount: 100, currency: 'EUR',
      depositTime: new Date(), createdAt: new Date(),
      customerId: 'C', customerName: 'X', shamCashTxId: 'S2', rawData: {},
    } as unknown as PlatformDepositRow
    const result = crossMatchSendsWithDeposits(
      [sc({ txId: 'S2', sentAmount: 100, currency: 'USD' })],
      [dep],
      new Set(),
    )
    expect(result.crossMatched.length).toBe(0)
  })

  it('skips deposits already used by another step', () => {
    const dep = {
      txId: 'D4', amount: 100, currency: 'USD',
      depositTime: new Date(), createdAt: new Date(),
      customerId: 'C', customerName: 'X', shamCashTxId: 'S3', rawData: {},
    } as unknown as PlatformDepositRow
    const result = crossMatchSendsWithDeposits(
      [sc({ txId: 'S3', sentAmount: 100, currency: 'USD' })],
      [dep],
      new Set(['D4']),  // already consumed by deposit reconciliation
    )
    expect(result.crossMatched.length).toBe(0)
  })
})
