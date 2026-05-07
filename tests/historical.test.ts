import { describe, it, expect } from 'vitest'
import { resolveHistoricalComplaints } from '@/lib/reconciliation/deposits'
import type { PlatformDepositRow } from '@/types'

function depRow(over: Partial<PlatformDepositRow>): PlatformDepositRow {
  return {
    txId: 'P1', userId: '', amount: 100, currency: 'USD', status: 'OK',
    bankName: '', provider: '',
    createdAt: new Date('2026-04-28T10:00:00+03:00'),
    depositTime: new Date('2026-04-28T10:01:00+03:00'),
    userInfo: '', shamCashTxId: null, admin: '',
    ...over,
  } as unknown as PlatformDepositRow
}

describe('resolveHistoricalComplaints — match old PENDING_SC by platformUserId', () => {
  it('matches when same platformUserId + amount within tolerance', () => {
    const pending = [{
      id: 'sc-old',
      platformUserId: 'USER-99',
      amount: 50,
      txDateTime: new Date('2026-04-28T09:55:00+03:00'),
    }]
    const platformRows = [
      depRow({ txId: 'P-NEW', userId: 'USER-99', amount: 50 }),
    ]
    const resolved = resolveHistoricalComplaints(pending, platformRows)
    expect(resolved.length).toBe(1)
    expect(resolved[0].pendingTxId).toBe('sc-old')
    expect(resolved[0].platformRow.txId).toBe('P-NEW')
  })

  it('does NOT match when platformUserId differs', () => {
    const pending = [{
      id: 'sc-old', platformUserId: 'USER-A', amount: 50,
      txDateTime: new Date('2026-04-28T09:55:00+03:00'),
    }]
    const resolved = resolveHistoricalComplaints(pending, [
      depRow({ userId: 'USER-B', amount: 50 }),
    ])
    expect(resolved.length).toBe(0)
  })

  it('does NOT match when amount differs (no fuzzy match)', () => {
    const pending = [{
      id: 'sc-old', platformUserId: 'USER-99', amount: 50,
      txDateTime: new Date('2026-04-28T09:55:00+03:00'),
    }]
    const resolved = resolveHistoricalComplaints(pending, [
      depRow({ userId: 'USER-99', amount: 51 }),
    ])
    expect(resolved.length).toBe(0)
  })

  it('returns empty when pending list is empty', () => {
    expect(resolveHistoricalComplaints([], [depRow({})])).toEqual([])
  })

  it('returns empty when platform list is empty', () => {
    const pending = [{
      id: 'sc-old', platformUserId: 'USER-99', amount: 50,
      txDateTime: new Date(),
    }]
    expect(resolveHistoricalComplaints(pending, [])).toEqual([])
  })

  it('skips pending rows with no platformUserId', () => {
    const pending = [{
      id: 'sc-old', platformUserId: null, amount: 50,
      txDateTime: new Date(),
    }]
    const resolved = resolveHistoricalComplaints(pending, [
      depRow({ userId: 'USER-99', amount: 50 }),
    ])
    expect(resolved.length).toBe(0)
  })
})
