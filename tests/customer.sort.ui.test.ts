import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('next/navigation', () => ({
  useParams: () => ({ name: 'Customer' }), useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => vi.fn() }))
import CustomerPage from '@/app/(dashboard)/customers/[name]/page'
import UploadHistoryPage from '@/app/(dashboard)/upload-history/page'
import DataTable from '@/components/tables/DataTable'

describe('sortable page headers', () => {
  it('exposes keyboard-sortable amount headers on the real customer page', () => {
    const html = renderToStaticMarkup(React.createElement(CustomerPage))
    expect(html).toMatch(/<th[^>]*tabindex="0"[^>]*>[\s\S]*?المبلغ/)
    expect(html).toContain('اضغط للترتيب')
    expect(html).toContain('aria-sort="descending"')
  })
  it('shows the authoritative server sort rather than stale local state', () => {
    const html = renderToStaticMarkup(React.createElement(DataTable, {
      data: [{ id: '1', amount: 75 }], columns: [{ key: 'amount', header: 'Amount' }],
      serverPagination: { total: 100, hasNextPage: true, onNextPage: vi.fn() },
      onServerSortChange: vi.fn(), serverSort: { key: 'amount', direction: 'asc' },
    }))
    expect(html).toContain('aria-sort="ascending"')
    expect(html).toContain('tabindex="0"')
  })
  it('offers clickable upload-history headings without sorting action columns', () => {
    const html = renderToStaticMarkup(React.createElement(UploadHistoryPage))
    expect(html).toContain('اضغط للتبديل بين الترتيب التصاعدي والتنازلي')
    expect(html).toContain('aria-sort="descending"')
    expect(html).toContain('الصفوف المعالجة')
    expect(html).toContain('<th>إجراء</th>')
  })
})
