import { describe, expect, it } from 'vitest'
import { sameCurrency, uniqueCurrencyCandidates, currencyMatchKey } from '@/lib/reconciliation/currencyGuard'

describe('matching currency invariant', () => {
  it('normalizes legitimate currency formatting but rejects unknown currencies', () => {
    expect(sameCurrency(' usd ', 'USD')).toBe(true)
    for (const pair of [['SYP', 'USD'], ['', ''], [undefined, undefined], [null, 'USD']]) {
      expect(sameCurrency(pair[0], pair[1])).toBe(false)
    }
  })
  it('keeps different currencies distinct and refuses ambiguous candidates', () => {
    const map = uniqueCurrencyCandidates([
      { shamCashTxId: 'X', currency: 'USD' }, { shamCashTxId: 'X', currency: ' usd ' },
      { shamCashTxId: 'X', currency: 'SYP' },
    ])
    expect(map.has(currencyMatchKey('X', 'USD'))).toBe(false)
    expect(map.has(currencyMatchKey('X', 'SYP'))).toBe(true)
  })
})
