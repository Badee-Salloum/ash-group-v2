import { describe, it, expect } from 'vitest'
import { fmtSYP } from '@/lib/currency'

describe('fmtSYP — SYP currency formatter', () => {
  it('formats 1000 with thousand separator and ل.س symbol', () => {
    expect(fmtSYP(1000)).toBe('1,000 ل.س')
  })

  it('formats 0 cleanly', () => {
    expect(fmtSYP(0)).toBe('0 ل.س')
  })

  it('treats null as 0', () => {
    expect(fmtSYP(null)).toBe('0 ل.س')
  })

  it('treats undefined as 0', () => {
    expect(fmtSYP(undefined)).toBe('0 ل.س')
  })

  it('formats large numbers with multiple separators', () => {
    expect(fmtSYP(1234567)).toBe('1,234,567 ل.س')
  })

  it('rounds decimals away (no fractional ل.س)', () => {
    expect(fmtSYP(123.45)).toBe('123 ل.س')
    expect(fmtSYP(123.6)).toBe('124 ل.س')
  })

  it('returns just the number when withSymbol=false', () => {
    expect(fmtSYP(1500, { withSymbol: false })).toBe('1,500')
  })

  it('handles negative numbers', () => {
    expect(fmtSYP(-500)).toBe('-500 ل.س')
  })
})
