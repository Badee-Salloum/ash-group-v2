import { describe, it, expect } from 'vitest'
import { isInternalTransfer } from '@/lib/reconciliation/walletMatch'

describe('isInternalTransfer — wallet identifier matching', () => {
  it('returns false when walletIdentifiers is empty', () => {
    expect(isInternalTransfer('123', 'محمود', '', [])).toBe(false)
  })

  it('returns false when walletIdentifiers is null/undefined', () => {
    expect(isInternalTransfer('123', 'name', '', undefined as never)).toBe(false)
  })

  it('matches when accountName contains all words of an identifier', () => {
    expect(isInternalTransfer(
      '****1234',
      'محفظة الفرع الرئيسي',
      '',
      ['محفظة الفرع'],
    )).toBe(true)
  })

  it('matches against accountNumber substring', () => {
    expect(isInternalTransfer(
      '************4762',
      'someone',
      '',
      ['4762'],
    )).toBe(true)
  })

  it('matches against notes field', () => {
    expect(isInternalTransfer(
      '',
      '',
      'تحويل إلى محفظة الفرع',
      ['محفظة الفرع'],
    )).toBe(true)
  })

  it('requires ALL words of multi-word identifier to be present', () => {
    expect(isInternalTransfer(
      '',
      'محفظة الشركة',  // missing "الفرع"
      '',
      ['محفظة الفرع'],
    )).toBe(false)
  })

  it('returns false when no identifier matches', () => {
    expect(isInternalTransfer(
      '****1234',
      'حسان احمد صطوف',
      '',
      ['محفظة الفرع', 'الحساب الرئيسي'],
    )).toBe(false)
  })

  it('matches the FIRST matching identifier (OR semantics across identifiers)', () => {
    expect(isInternalTransfer(
      '',
      'الحساب الرئيسي',
      '',
      ['محفظة الفرع', 'الحساب الرئيسي'],
    )).toBe(true)
  })

  it('case-insensitive substring match', () => {
    expect(isInternalTransfer(
      '',
      'BRANCH WALLET',
      '',
      ['branch wallet'],
    )).toBe(true)
  })

  it('single-char words (e.g. "R") require token match, not substring', () => {
    // "R" should match "R K O" wallet but not "RANDOM"
    expect(isInternalTransfer('', 'RANDOM', '', ['R'])).toBe(false)
    expect(isInternalTransfer('', 'A R B', '', ['R'])).toBe(true)
  })

  it('handles undefined accountNumber/accountName/notes gracefully', () => {
    expect(isInternalTransfer(undefined, undefined, undefined, ['x'])).toBe(false)
    expect(isInternalTransfer(null, null, null, ['x'])).toBe(false)
  })

  it('empty walletIdentifier string is ignored', () => {
    expect(isInternalTransfer('', 'anything', '', [''])).toBe(false)
  })
})
