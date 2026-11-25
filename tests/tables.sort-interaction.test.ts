import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ setSort: vi.fn() }))
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(), useState: () => [null, mocks.setSort] }))
import { Children, createElement as h, isValidElement, type ReactNode, type ReactElement } from 'react'
import { SortableTable, type TableSort } from '@/components/tables/SortableTable'

function buttons(node: ReactNode): ReactElement<{ onClick: () => void }>[] {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; onClick: () => void }>(child)) return []
    return child.type === 'button' ? [child] : buttons(child.props.children)
  })
}
function table(sort: TableSort | null, onSortChange?: (sort: TableSort) => void, sortableIndexes?: number[]) {
  return SortableTable({ sort, onSortChange, sortableIndexes, children: h('thead', {}, h('tr', {},
    h('th', {}, 'المبلغ'), h('th', {}, 'التاريخ'), h('th', {}, 'إجراء'), h('th', {}, h('input', { type: 'checkbox' })),
  )) })
}
beforeEach(() => vi.clearAllMocks())
describe('column click interactions', () => {
  it('starts a new column in ascending order', () => {
    const change = vi.fn()
    buttons(table(null, change))[0].props.onClick()
    expect(change).toHaveBeenCalledWith({ index: 0, direction: 'asc' })
  })
  it('toggles the active column from ascending to descending and back', () => {
    const change = vi.fn()
    buttons(table({ index: 0, direction: 'asc' }, change))[0].props.onClick()
    expect(change).toHaveBeenLastCalledWith({ index: 0, direction: 'desc' })
    buttons(table({ index: 0, direction: 'desc' }, change))[0].props.onClick()
    expect(change).toHaveBeenLastCalledWith({ index: 0, direction: 'asc' })
  })
  it('resets direction when switching to another column', () => {
    const change = vi.fn()
    buttons(table({ index: 0, direction: 'desc' }, change))[1].props.onClick()
    expect(change).toHaveBeenCalledWith({ index: 1, direction: 'asc' })
  })
  it('never makes actions or selection headers sortable', () => {
    expect(buttons(table(null))).toHaveLength(2)
    expect(buttons(table(null, vi.fn(), [1]))).toHaveLength(1)
  })
  it('updates local table state without triggering server ordering', () => {
    buttons(table(null))[1].props.onClick()
    expect(mocks.setSort).toHaveBeenCalledWith({ index: 1, direction: 'asc' })
  })
})
