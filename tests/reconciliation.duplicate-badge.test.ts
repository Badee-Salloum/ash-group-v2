import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { buildColumns } from '@/app/(dashboard)/reconciliation/_components/columns'

const columns = buildColumns({
  data: [], restricted: false, matchInfo: {}, setEditTx: vi.fn(), reload: vi.fn(),
})

function cell(key: string, row: Record<string, unknown>) {
  return renderToStaticMarkup(React.createElement(React.Fragment, null,
    columns.find(column => column.key === key)!.render!(row)))
}

describe('same duplicate presentation for currency review cases', () => {
  it('uses the normal red duplicate badge without a separate currency badge', () => {
    const html = cell('shamCashTxId', {
      shamCashTxId: '476153071', hasDuplicateSc: false, hasCurrencyMismatch: true,
    })
    expect(html).toContain('⚠ مكرّر')
    expect(html).toContain('bg-red-100')
    expect(html).not.toContain('اختلاف عملة')
  })

  it('shows just one badge when both review reasons apply', () => {
    const html = cell('shamCashTxId', {
      shamCashTxId: 'SC-1', hasDuplicateSc: true, hasCurrencyMismatch: true,
    })
    expect(html.match(/<button/g)).toHaveLength(1)
  })

  it('keeps the original matching status, with no new status label', () => {
    const html = cell('status', { status: 'MATCHED', hasCurrencyMismatch: true })
    expect(html).toContain('badge-matched')
    expect(html).toContain('مطابقة')
    expect(html).not.toContain('اختلاف')
    expect(cell('status', { status: 'WASTE', hasCurrencyMismatch: true })).toContain('هدر')
  })
})
