import { describe, expect, it } from 'vitest'
import { hasLinkedCurrencyMismatch } from '@/lib/reconciliation/duplicateReview'

describe('linked currency review', () => {
  it('flags USD/SYP links, irrespective of amounts or transaction status', () => {
    expect(hasLinkedCurrencyMismatch({ currency: 'SYP', matchedTx: { currency: 'USD' } })).toBe(true)
    expect(hasLinkedCurrencyMismatch({ currency: 'USD', matchedTx: { currency: 'SYP' } })).toBe(true)
  })
  it('normalizes formatting and does not flag an unlinked row', () => {
    expect(hasLinkedCurrencyMismatch({ currency: ' usd ', matchedTx: { currency: 'USD' } })).toBe(false)
    expect(hasLinkedCurrencyMismatch({ currency: 'SYP', matchedTx: null })).toBe(false)
  })
})
