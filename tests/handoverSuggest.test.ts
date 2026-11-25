import { describe, it, expect } from 'vitest'
import { suggestHandover, type RosterMember } from '@/lib/schedule/handoverSuggest'

function m(userId: string, walletIds: string[] = []): RosterMember {
  return { userId, walletIds }
}

describe('suggestHandover — index fallback (no wallets)', () => {
  it('pairs this-shift[i] with prev-shift[i]', () => {
    const r = suggestHandover([m('a'), m('b')], [m('x'), m('y')])
    expect(r).toEqual({ a: ['x'], b: ['y'] })
  })
  it('takers beyond the prev roster size get no source', () => {
    const r = suggestHandover([m('a'), m('b'), m('c')], [m('x')])
    expect(r).toEqual({ a: ['x'], b: [], c: [] })
  })
  it('empty prev shift → everyone gets []', () => {
    const r = suggestHandover([m('a'), m('b')], [])
    expect(r).toEqual({ a: [], b: [] })
  })
})

describe('suggestHandover — wallet-coverage pairing', () => {
  it('pairs a taker with the prev employee holding the same wallet', () => {
    const r = suggestHandover(
      [m('taker', ['W1'])],
      [m('x', ['W1']), m('y', ['W2'])],
    )
    expect(r.taker).toEqual(['x'])
  })

  it('multi-source: union of two prev employees covers the taker', () => {
    const r = suggestHandover(
      [m('taker', ['W1', 'W2'])],
      [m('x', ['W1']), m('y', ['W2'])],
    )
    // taker needs W1+W2 — both prev employees are required.
    expect(r.taker.sort()).toEqual(['x', 'y'])
  })

  it('picks the largest-overlap source first (greedy)', () => {
    const r = suggestHandover(
      [m('taker', ['W1', 'W2', 'W3'])],
      [m('big', ['W1', 'W2']), m('small', ['W3']), m('none', ['W9'])],
    )
    expect(r.taker.sort()).toEqual(['big', 'small'])
    expect(r.taker).not.toContain('none')
  })

  it('a taker with no wallets gets no source even when others have wallets', () => {
    const r = suggestHandover(
      [m('taker', []), m('other', ['W1'])],
      [m('x', ['W1'])],
    )
    expect(r.taker).toEqual([])
    expect(r.other).toEqual(['x'])
  })

  it('uncoverable wallets simply stop the greedy loop (partial coverage)', () => {
    const r = suggestHandover(
      [m('taker', ['W1', 'W_UNKNOWN'])],
      [m('x', ['W1'])],
    )
    expect(r.taker).toEqual(['x']) // W_UNKNOWN has no holder — stops there
  })
})
