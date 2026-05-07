import { describe, it, expect } from 'vitest'

// Pure decision logic extracted from batchProcessor.persist.ts dedupe.
// Splits incoming existing rows into 'stale' (PENDING, will be deleted) and
// 'kept' (MATCHED/etc, the new record should be dropped).

interface ExistingRow {
  id: string
  status: string
}

function categorize(rows: ExistingRow[]): { stale: string[]; keptStatuses: string[] } {
  const stale: string[] = []
  const keptStatuses: string[] = []
  for (const r of rows) {
    if (r.status === 'PENDING_SC' || r.status === 'PENDING_P') {
      stale.push(r.id)
    } else {
      keptStatuses.push(r.status)
    }
  }
  return { stale, keptStatuses }
}

// Pair logic: when a record is dropped, its matched-pair partner must also be
// dropped to avoid orphan MATCHED rows pointing at nothing.
function dropOrphanPairs<T extends { id: string }>(
  records: T[],
  droppedIds: Set<string>,
  matchedPairs: Array<[string, string]>,
): T[] {
  return records.filter(r => {
    const pair = matchedPairs.find(p => p[0] === r.id || p[1] === r.id)
    if (!pair) return true
    return !droppedIds.has(pair[0]) && !droppedIds.has(pair[1])
  })
}

describe('dedupe — categorization', () => {
  it('PENDING_SC → stale', () => {
    const r = categorize([{ id: '1', status: 'PENDING_SC' }])
    expect(r.stale).toEqual(['1'])
    expect(r.keptStatuses.length).toBe(0)
  })

  it('PENDING_P → stale', () => {
    const r = categorize([{ id: '2', status: 'PENDING_P' }])
    expect(r.stale).toEqual(['2'])
  })

  it('MATCHED → kept (drop new)', () => {
    const r = categorize([{ id: '3', status: 'MATCHED' }])
    expect(r.stale.length).toBe(0)
    expect(r.keptStatuses).toEqual(['MATCHED'])
  })

  it('DISCREPANCY → kept', () => {
    const r = categorize([{ id: '4', status: 'DISCREPANCY' }])
    expect(r.keptStatuses).toEqual(['DISCREPANCY'])
  })

  it('WASTE → kept', () => {
    const r = categorize([{ id: '5', status: 'WASTE' }])
    expect(r.keptStatuses).toEqual(['WASTE'])
  })

  it('mixed batch routes correctly', () => {
    const r = categorize([
      { id: 'a', status: 'PENDING_SC' },
      { id: 'b', status: 'MATCHED' },
      { id: 'c', status: 'PENDING_P' },
      { id: 'd', status: 'DISCREPANCY' },
    ])
    expect(r.stale.sort()).toEqual(['a', 'c'])
    expect(r.keptStatuses.sort()).toEqual(['DISCREPANCY', 'MATCHED'])
  })
})

describe('dedupe — orphan pair pruning', () => {
  it('keeps records whose pair partners are both intact', () => {
    const recs = [{ id: 'sc1' }, { id: 'pl1' }]
    const out = dropOrphanPairs(recs, new Set(), [['sc1', 'pl1']])
    expect(out.length).toBe(2)
  })

  it('drops both pair partners when one is dropped', () => {
    const recs = [{ id: 'sc1' }, { id: 'pl1' }]
    const out = dropOrphanPairs(recs, new Set(['sc1']), [['sc1', 'pl1']])
    expect(out.length).toBe(0)
  })

  it('keeps unpaired records regardless of dropped set', () => {
    const recs = [{ id: 'lonely' }]
    const out = dropOrphanPairs(recs, new Set(['something-else']), [])
    expect(out).toEqual([{ id: 'lonely' }])
  })

  it('handles multiple pairs independently', () => {
    const recs = [
      { id: 'sc1' }, { id: 'pl1' },   // pair A — both kept
      { id: 'sc2' }, { id: 'pl2' },   // pair B — sc2 dropped → both gone
    ]
    const out = dropOrphanPairs(recs, new Set(['sc2']), [
      ['sc1', 'pl1'],
      ['sc2', 'pl2'],
    ])
    expect(out.map(r => r.id).sort()).toEqual(['pl1', 'sc1'])
  })
})
