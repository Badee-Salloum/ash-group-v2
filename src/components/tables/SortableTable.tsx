'use client'

import { Children, Fragment, cloneElement, isValidElement, useState, type ReactNode, type ReactElement, type TableHTMLAttributes } from 'react'
import { compareTableValues, type SortDirection } from '@/lib/tables/sort'

export type TableSort = { index: number; direction: SortDirection }
type Element = ReactElement<Record<string, unknown>>

function elements(children: ReactNode): Element[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<Record<string, unknown>>(child)) return []
    return child.type === Fragment ? elements(child.props.children as ReactNode) : [child]
  })
}

/** Extract semantic values, never DOM text or interactive menu contents. */
export function tableCellValue(node: ReactNode): unknown {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map(tableCellValue).join(' ')
  if (!isValidElement<Record<string, unknown>>(node)) return ''
  const p = node.props
  if ('data-sort-value' in p) return p['data-sort-value']
  if (node.type === 'svg' || node.type === 'button' || node.type === 'input') return ''
  if (p.batch && typeof p.batch === 'object' && 'createdAt' in p.batch) return (p.batch as { createdAt: unknown }).createdAt
  if (p.children != null) return tableCellValue(p.children as ReactNode)
  return p.status ?? p.category ?? p.name ?? p.value ?? ''
}

export function sortTableRows(children: ReactNode, sort: TableSort | null): ReactNode {
  if (!sort) return children
  let groups: Element[][] = []
  const result: Element[] = []
  const flush = () => {
    groups.sort((a, b) => compareTableValues(
      tableCellValue(elements(a[0].props.children as ReactNode)[sort.index]),
      tableCellValue(elements(b[0].props.children as ReactNode)[sort.index]), sort.direction,
    ))
    result.push(...groups.flat())
    groups = []
  }
  for (const row of elements(children)) {
    const cells = elements(row.props.children as ReactNode)
    if (cells.length === 1 && Number(cells[0].props.colSpan) > 1) {
      // Expandable details travel with their employee/parent row.
      if (row.key?.includes('-detail') && groups.length) groups[groups.length - 1].push(row)
      else { flush(); result.push(row) }
    } else if (row.props['data-sort-fixed'] || row.type !== 'tr' || cells.some(cell => Number(cell.props.colSpan) > 1)) { flush(); result.push(row) }
    else groups.push([row])
  }
  flush()
  return result
}

interface Props extends TableHTMLAttributes<HTMLTableElement> {
  sort?: TableSort | null
  onSortChange?: (sort: TableSort) => void
  /** Explicit indexes for API-backed tables. Omit for fully loaded local tables. */
  sortableIndexes?: readonly number[]
}

/** A React-owned sorter for existing semantic tables; no DOM mutation. */
export function SortableTable({ children, sort: controlled, onSortChange, sortableIndexes, ...props }: Props) {
  const [local, setLocal] = useState<TableSort | null>(null)
  const sort = controlled === undefined ? local : controlled
  const change = (index: number) => {
    const next: TableSort = { index, direction: sort?.index === index && sort.direction === 'asc' ? 'desc' : 'asc' }
    if (onSortChange) onSortChange(next)
    else setLocal(next)
  }
  const content = elements(children).map(section => {
    if (section.type === 'thead') return cloneElement(section, {}, elements(section.props.children as ReactNode).map(row =>
      cloneElement(row, {}, elements(row.props.children as ReactNode).map((cell, index) => {
        const label = String(tableCellValue(cell) ?? '').trim()
        if (cell.type !== 'th' || !label || Number(cell.props.colSpan || 1) > 1 || cell.props['data-sortable'] === false
          || /^(إجراء|الإجراء|إجراءات|الإجراءات|تحديد|تأكيد|#)$/.test(label) || cell.props.onClick
          || (sortableIndexes && !sortableIndexes.includes(index))) return cell
        const active = sort?.index === index
        return cloneElement(cell, { 'aria-sort': active ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none' },
          <button type="button" className="inline-flex items-center gap-1 hover:text-brand-600 focus-visible:outline focus-visible:outline-2 rounded"
            onClick={() => change(index)} title={`ترتيب حسب ${label}`}>
            {cell.props.children as ReactNode}<span aria-hidden="true" className={active ? 'text-brand-600' : 'text-gray-300'}>{active ? sort.direction === 'asc' ? '↑' : '↓' : '↕'}</span>
          </button>)
      }))))
    if (section.type === 'tbody' && !onSortChange) return cloneElement(section, {}, sortTableRows(section.props.children as ReactNode, sort))
    return section
  })
  return <table {...props}>{content}</table>
}
