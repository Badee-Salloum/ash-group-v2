'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import DataTable, { type Column } from './DataTable'
import { fmtSyria } from '@/lib/datetime'

export interface QueryTransaction extends Record<string, unknown> {
  id: string; txDateTime: string; amount: string; currency: string; amountDiff: string | null
  customerName: string | null; account: { name: string }; type: string; status: string; source: string
  shamCashTxId: string | null; platformTxId: string | null; platformUserId: string | null
  matchedTx?: { shamCashTxId: string | null; platformTxId: string | null; platformUserId: string | null } | null
}
const STATUS: Record<string, string> = { MATCHED: 'مطابقة', PENDING_SC: 'شام كاش فقط', PENDING_P: 'المنصة فقط', DISCREPANCY: 'فارق في المبلغ', WASTE: 'هدر', RETURNS: 'مرتجعات' }

/** All transaction drill-downs share the same bounded, cancellable keyset API. */
export function TransactionQueryTable({ query, renderActions, refreshKey }: { query: string; renderActions?: (row: QueryTransaction) => ReactNode; refreshKey?: unknown }) {
  const [sort, setSort] = useState({ key: 'txDateTime', direction: 'desc' as 'asc' | 'desc' })
  const [limit, setLimit] = useState(50)
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState<{ cursor: string | null; history: Array<string | null> }>({ cursor: null, history: [] })
  const [result, setResult] = useState<{ rows: QueryTransaction[]; next: string | null; total: number }>({ rows: [], next: null, total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const scope = `${query}|${sort.key}|${sort.direction}|${limit}|${search}`
  const [previousScope, setPreviousScope] = useState(scope)
  // Reset synchronously: never fetch a cursor belonging to an old filter/sort.
  if (previousScope !== scope) {
    setPreviousScope(scope)
    setPosition({ cursor: null, history: [] })
    setResult(previous => ({ ...previous, next: null }))
  }
  const requestId = useRef(0)
  useEffect(() => {
    const controller = new AbortController(), id = ++requestId.current
    const params = new URLSearchParams(query)
    params.set('limit', String(limit)); params.set('sortBy', sort.key); params.set('sortDir', sort.direction)
    if (search) params.set('search', search)
    if (position.cursor) params.set('cursor', position.cursor)
    setLoading(true); setError('')
    void fetch(`/api/transactions/query?${params}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const payload = await response.json()
        if (!response.ok || !payload.success) throw new Error(payload.error || 'تعذر تحميل العمليات')
        if (id === requestId.current) setResult({ rows: payload.data, next: payload.pageInfo.nextCursor, total: payload.pageInfo.total })
      }).catch(e => { if (!controller.signal.aborted && id === requestId.current) setError(e instanceof Error ? e.message : 'تعذر التحميل') })
      .finally(() => { if (id === requestId.current) setLoading(false) })
    return () => controller.abort()
  }, [query, sort, limit, search, position.cursor, retry, refreshKey])
  const columns: Column<QueryTransaction>[] = [
    { key: 'txDateTime', header: 'التاريخ', render: r => <span className="font-mono text-xs">{fmtSyria(r.txDateTime)}</span> },
    { key: 'account', header: 'الحساب', render: r => r.account?.name || '—' },
    { key: 'customerName', header: 'اسم العميل', render: r => r.customerName || '—' },
    { key: 'type', header: 'النوع', render: r => r.type === 'DEPOSIT' ? 'إيداع' : 'سحب' },
    { key: 'status', header: 'الحالة', render: r => STATUS[r.status] || r.status },
    { key: 'source', header: 'المصدر', render: r => r.source === 'SHAM_CASH' ? 'شام كاش' : 'المنصة' },
    { key: 'shamCashTxId', header: 'رقم شام كاش', render: r => r.shamCashTxId || r.matchedTx?.shamCashTxId || '—' },
    { key: 'platformTxId', header: 'رقم المنصة', render: r => r.platformTxId || r.matchedTx?.platformTxId || '—' },
    { key: 'platformUserId', header: 'USER ID', render: r => r.platformUserId || r.matchedTx?.platformUserId || '—' },
    { key: 'amount', header: 'المبلغ', render: r => <span className="font-mono">{Number(r.amount).toLocaleString('en', { minimumFractionDigits: 2 })} {r.currency}</span> },
    { key: 'amountDiff', header: 'الفارق', render: r => r.amountDiff == null ? '—' : Number(r.amountDiff).toLocaleString('en') },
    ...(renderActions ? [{ key: 'actions', header: 'إجراء', sortable: false, render: renderActions }] : []),
  ]
  const updateSearch = useCallback((value: string) => setSearch(value), [])
  return <div className="space-y-2">
    {error && <div role="alert" className="text-sm text-red-600">{error} <button className="btn-secondary btn-sm" onClick={() => setRetry(n => n + 1)}>إعادة المحاولة</button></div>}
    <DataTable data={result.rows} columns={columns} loading={loading} pageSize={limit} pageSizeOptions={[25, 50, 100]}
      exportable={false} getRowId={r => r.id} serverSort={sort} onServerSortChange={setSort}
      serverSortableKeys={columns.filter(c => c.sortable !== false).map(c => c.key)} onServerSearchChange={updateSearch}
      serverPagination={{ total: result.total, page: position.history.length + 1, hasNextPage: !!result.next,
        hasPreviousPage: position.history.length > 0, onPageSizeChange: setLimit,
        onNextPage: () => { if (!loading && result.next) setPosition(p => ({ cursor: result.next, history: [...p.history, p.cursor] })) },
        onPreviousPage: () => { if (!loading) setPosition(p => ({ cursor: p.history.at(-1) ?? null, history: p.history.slice(0, -1) })) },
      }} />
  </div>
}
