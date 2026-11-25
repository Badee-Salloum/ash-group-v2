import { describe, it, expect } from 'vitest'
import {
  categorizeExisting,
  pruneOrphanPairs,
  prunePairs,
} from '@/lib/reconciliation/dedupeLogic'

// These tests pin the dedupe decision logic that gates whether an incoming
// upload row replaces an existing DB row or is dropped as a duplicate. The
// logic lives in `src/lib/reconciliation/dedupeLogic.ts` and is consumed by
// `batchProcessor.persist.ts` — so a regression in production code shows up
// here.

describe('categorizeExisting', () => {
  it('PENDING_SC → stale', () => {
    const r = categorizeExisting([{ id: '1', status: 'PENDING_SC', idKey: 'tx1' }])
    expect(r.staleIds).toEqual(['1'])
    expect(r.keptKeys.size).toBe(0)
  })

  it('PENDING_P → stale', () => {
    const r = categorizeExisting([{ id: '2', status: 'PENDING_P', idKey: 'tx2' }])
    expect(r.staleIds).toEqual(['2'])
  })

  it('MATCHED → kept (drop new)', () => {
    const r = categorizeExisting([{ id: '3', status: 'MATCHED', idKey: 'tx3' }])
    expect(r.staleIds.length).toBe(0)
    expect([...r.keptKeys]).toEqual(['tx3'])
  })

  it('DISCREPANCY → kept', () => {
    const r = categorizeExisting([{ id: '4', status: 'DISCREPANCY', idKey: 'tx4' }])
    expect([...r.keptKeys]).toEqual(['tx4'])
  })

  it('WASTE → kept', () => {
    const r = categorizeExisting([{ id: '5', status: 'WASTE', idKey: 'tx5' }])
    expect([...r.keptKeys]).toEqual(['tx5'])
  })

  it('rows with null idKey are skipped entirely', () => {
    const r = categorizeExisting([
      { id: '6', status: 'MATCHED', idKey: null },
      { id: '7', status: 'PENDING_SC', idKey: null },
    ])
    expect(r.staleIds.length).toBe(0)
    expect(r.keptKeys.size).toBe(0)
  })

  it('mixed batch routes correctly', () => {
    const r = categorizeExisting([
      { id: 'a', status: 'PENDING_SC', idKey: 'kA' },
      { id: 'b', status: 'MATCHED', idKey: 'kB' },
      { id: 'c', status: 'PENDING_P', idKey: 'kC' },
      { id: 'd', status: 'DISCREPANCY', idKey: 'kD' },
    ])
    expect(r.staleIds.sort()).toEqual(['a', 'c'])
    expect([...r.keptKeys].sort()).toEqual(['kB', 'kD'])
  })
})

describe('pruneOrphanPairs', () => {
  it('keeps records whose pair partners are both intact', () => {
    const recs = [{ id: 'sc1' }, { id: 'pl1' }]
    const out = pruneOrphanPairs(recs, new Set(), [['sc1', 'pl1']])
    expect(out.length).toBe(2)
  })

  it('drops both pair partners when one is dropped', () => {
    const recs = [{ id: 'sc1' }, { id: 'pl1' }]
    const out = pruneOrphanPairs(recs, new Set(['sc1']), [['sc1', 'pl1']])
    expect(out.length).toBe(0)
  })

  it('keeps unpaired records regardless of dropped set', () => {
    const recs = [{ id: 'lonely' }]
    const out = pruneOrphanPairs(recs, new Set(['something-else']), [])
    expect(out).toEqual([{ id: 'lonely' }])
  })

  it('handles multiple pairs independently', () => {
    const recs = [
      { id: 'sc1' }, { id: 'pl1' },   // pair A — both kept
      { id: 'sc2' }, { id: 'pl2' },   // pair B — sc2 dropped → both gone
    ]
    const out = pruneOrphanPairs(recs, new Set(['sc2']), [
      ['sc1', 'pl1'],
      ['sc2', 'pl2'],
    ])
    expect(out.map(r => r.id).sort()).toEqual(['pl1', 'sc1'])
  })
})

describe('prunePairs', () => {
  it('drops pairs where either id was dropped', () => {
    const out = prunePairs(
      [['a', 'b'], ['c', 'd']],
      new Set(['a']),
    )
    expect(out).toEqual([['c', 'd']])
  })

  it('keeps pairs untouched by drop set', () => {
    const out = prunePairs([['a', 'b']], new Set(['z']))
    expect(out).toEqual([['a', 'b']])
  })

  it('returns empty when both partners dropped', () => {
    const out = prunePairs([['a', 'b']], new Set(['a', 'b']))
    expect(out).toEqual([])
  })
})
