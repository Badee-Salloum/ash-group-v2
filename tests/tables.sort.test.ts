import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { compareTableValues } from '@/lib/tables/sort'
import { SortableTable, sortTableRows, tableCellValue } from '@/components/tables/SortableTable'
import { readFileSync } from 'node:fs'

const h = React.createElement
const row = (id: string, value: unknown) => h('tr', { key: id }, h('td', { 'data-sort-value': value }, id))
describe('shared numeric and semantic table sorting', () => {
  it.each([
    ['1,200.50', '900', 1], ['١٬٢٠٠', '٩٠٠', 1], ['−2.5', '0', -1],
    ['9.9%', '10%', -1], ['100,000 ل.س', '900 ل.س', 1], ['USD 9.50', '10.00 USD', -1],
    ['2026-10-01T01:00:00Z', '2026-09-30T23:59:59Z', 1], ['Employee 2', 'Employee 10', -1],
  ])('compares %s and %s by value', (a, b, expected) => {
    expect(Math.sign(compareTableValues(a, b))).toBe(expected)
    expect(Math.sign(compareTableValues(a, b, 'desc'))).toBe(-Number(expected))
  })
  it.each([null, undefined, '', '—', Number.NaN])('keeps missing %s at the end in both directions', value => {
    expect(compareTableValues(value, 0)).toBe(1)
    expect(compareTableValues(value, 0, 'desc')).toBe(1)
  })
  it('never adds unlike currencies and compares decimal amounts accurately', () => {
    expect(compareTableValues({ SYP: 100, USD: 0.9 }, { USD: 0.1, SYP: 100 })).toBeGreaterThan(0)
    expect(compareTableValues({ SYP: 1_000_000, USD: 1 }, { SYP: 1_000_001, USD: 10_000 })).toBeLessThan(0)
  })
  it('honours explicit values rather than badges, avatars or formatted subtitles', () => {
    const nodes = [row('large', 1000), row('small', 2), row('empty', null)]
    const sorted = sortTableRows(nodes, { index: 0, direction: 'asc' }) as React.ReactElement[]
    expect(sorted.map(n => n.key)).toEqual(expect.arrayContaining([expect.stringContaining('small')]))
    expect(tableCellValue((sorted[0].props as { children: React.ReactNode }).children)).toBe(2)
  })
  it('keeps expanded details with their parent, including fragments', () => {
    const detail = h('tr', { key: 'large-details' }, h('td', { colSpan: 3 }, 'details'))
    const sorted = sortTableRows([h(React.Fragment, { key: 'a' }, row('large', 100), detail), row('small', 2)], { index: 0, direction: 'asc' }) as React.ReactElement[]
    expect(sorted.map(n => n.key?.split('$').at(-1))).toEqual(['small', 'large', 'large-details'])
  })
  it('sorts inside currency sections without moving section headers or totals', () => {
    const header = (key: string) => h('tr', { key }, h('td', { colSpan: 3 }, key))
    const total = h('tr', { key: 'total', 'data-sort-fixed': true }, h('td', {}, 'total'))
    const sorted = sortTableRows([header('USD'), row('u2', 20), row('u1', 10), total, header('SYP'), row('s2', 200), row('s1', 100)], { index: 0, direction: 'asc' }) as React.ReactElement[]
    expect(sorted.map(n => n.key?.split('$').at(-1))).toEqual(['USD', 'u1', 'u2', 'total', 'SYP', 's1', 's2'])
  })
  it('renders keyboard-native buttons and active aria-sort without enabling actions', () => {
    const html = renderToStaticMarkup(h(SortableTable, { sort: { index: 0, direction: 'desc' } },
      h('thead', {}, h('tr', {}, h('th', {}, 'المبلغ'), h('th', {}, 'الإجراءات'))), h('tbody', {}, row('one', 1))))
    expect(html).toContain('aria-sort="descending"')
    expect(html).toContain('<button type="button"')
    expect(html).toContain('<th>الإجراءات</th>')
  })
  it('does not re-sort a server-controlled page locally', () => {
    const html = renderToStaticMarkup(h(SortableTable, { sort: { index: 0, direction: 'asc' }, onSortChange: () => {} },
      h('tbody', {}, row('first-from-api', 100), row('second-from-api', 1))))
    expect(html.indexOf('first-from-api')).toBeLessThan(html.indexOf('second-from-api'))
  })
  it('wires the server-sort contract on every server DataTable', () => {
    for (const path of ['customers/page.tsx', 'customers/[name]/page.tsx', 'reconciliation/page.tsx', 'expenses/page.tsx', 'consolidation-log/page.tsx']) {
      const source = readFileSync(`src/app/(dashboard)/${path}`, 'utf8')
      expect(source).toContain('onServerSortChange=')
      expect(source).toContain('serverSort=')
      expect(source).toContain('serverSortableKeys=')
    }
    for (const path of ['src/components/tables/TransactionQueryTable.tsx', 'src/app/(dashboard)/upload-history/_components/BatchPanel.tsx']) {
      expect(readFileSync(path, 'utf8')).not.toContain('.slice((page - 1)')
    }
  })
})
