import { describe, expect, it } from 'vitest'
import { deriveTransactionFields } from '@/lib/reconciliation/derivedFields'

describe('deriveTransactionFields', () => {
  it('derives a display name without retaining or rewriting raw payload data', () => {
    const raw = { accountName: 'Customer One', accountNumber: '1234', notes: 'deposit' }

    expect(deriveTransactionFields(raw, [], 'manual note')).toEqual({
      customerName: 'Customer One',
      isInternalTransferAuto: false,
    })
    expect(raw).toEqual({ accountName: 'Customer One', accountNumber: '1234', notes: 'deposit' })
  })

  it('reclassifies a notes edit that explicitly marks an internal transfer', () => {
    expect(deriveTransactionFields(
      { accountName: 'Customer Two' },
      [],
      'internal-transfer',
    )).toEqual({
      customerName: 'Customer Two',
      isInternalTransferAuto: true,
    })
  })
})
