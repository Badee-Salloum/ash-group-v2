'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import DataTable from '@/components/tables/DataTable'
import { Transaction, Filters, MatchInfoMap } from './_components/types'
import { EditModal, DuplicateScWarning } from './_components/EditModal'
import { FilterBar } from './_components/FilterBar'
import { buildColumns } from './_components/columns'

export default function ReconciliationPage() {
  const [data, setData] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; currency?: string; walletIdentifiers?: string[] }>>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<Filters>({
    status: '', type: '', accountId: '', currency: '', dateFrom: '', dateTo: '',
    reviewed: '', reviewCategory: '',
  })
  // Default: MATCHED rows are hidden; restored from the user's preferences on
  // mount so the choice survives reloads. `null` means "haven't read prefs
  // yet" — until then we hide (the default behavior) and skip persisting.
  const [hideMatched, setHideMatched] = useState<boolean | null>(null)
  const [availableCurrencies, setAvailableCurrencies] = useState<string[]>([])
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 })
  const [cursor, setCursor] = useState<string | null>(null)
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([])
  const [pageSize, setPageSize] = useState(50)
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'txDateTime',
    direction: 'desc',
  })
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [loadError, setLoadError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  // Reconciliation page always shows full data to SUPERVISOR & ACCOUNT_MGR.
  // Financial restrictions only apply to dashboard/accounts/profits pages.
  const restricted = false
  const _setRestricted = (_v: boolean) => {}
  void _setRestricted
  const [matchInfo, setMatchInfo] = useState<MatchInfoMap>({})
  // The filter bar owns server search.  It is debounced before touching the
  // cursor query so typing cannot trigger a request per keystroke.
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [duplicatesOnly, setDuplicatesOnly] = useState(false)
  const [duplicateScCount, setDuplicateScCount] = useState(0)
  // Transient toast for the "you just matched a SC number already used
  // elsewhere" warning surfaced by /api/transactions PATCH.
  const [dupWarning, setDupWarning] = useState<DuplicateScWarning | null>(null)

  const resetPagination = useCallback(() => {
    setCursor(null)
    setCursorHistory([])
    setNextCursor(null)
    setHasNextPage(false)
    setMeta(m => ({ ...m, page: 1 }))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search)
      resetPagination()
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search, resetPagination])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/accounts', { signal: controller.signal }).then(r => r.json()).then(d => {
      if (!d.success) return
      const accountRows = d.data as Array<{ id: string; name: string; currency?: string; walletIdentifiers?: string[] }>
      setAccounts(accountRows)
      setAvailableCurrencies(Array.from(new Set(accountRows.map(a => a.currency).filter(Boolean))) as string[])
    }).catch(() => {})
    fetch('/api/me/preferences').then(r => r.json()).then(d => {
      // Default true (hidden) when the user has never toggled it.
      const saved = d?.data?.hideMatched?.reconciliation
      setHideMatched(saved === false ? false : true)
    }).catch(() => setHideMatched(true))
    return () => controller.abort()
  }, [])

  function toggleHideMatched() {
    const next = !(hideMatched ?? true)
    setHideMatched(next)
    resetPagination()
    fetch('/api/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hideMatched: { reconciliation: next } }),
    }).catch(() => {})
  }

  const load = useCallback(async () => {
    // Avoid a bootstrap request before the persisted preference is known.
    if (hideMatched === null) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const requestId = ++requestIdRef.current
    setLoading(true)
    setLoadError('')
    setMatchInfo({})

    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => value && params.set(key, value))
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    if (duplicatesOnly) params.set('duplicates', '1')
    // Keep matched pairs available during a targeted search or duplicate review.
    if (hideMatched && !debouncedSearch.trim() && !duplicatesOnly) params.set('hideMatched', '1')
    params.set('excludeWalletTransfers', '1')
    params.set('limit', String(pageSize))
    params.set('sortBy', sort.key === 'accountName' ? 'customerName' : sort.key)
    params.set('sortDir', sort.direction)
    if (cursor) params.set('cursor', cursor)

    try {
      const response = await fetch(`/api/transactions/query?${params}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'تعذر تحميل المعاملات')
      if (requestId !== requestIdRef.current) return

      const rows = (payload.data || []) as Transaction[]
      const pageInfo = payload.pageInfo as {
        total?: number
        nextCursor?: string | null
        hasNext?: boolean
      }
      const total = Number(pageInfo?.total ?? 0)
      setData(rows)
      setMeta(previous => ({
        total,
        page: previous.page,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      }))
      setNextCursor(pageInfo?.nextCursor ?? null)
      setHasNextPage(Boolean(pageInfo?.hasNext))
      setDuplicateScCount(Number(payload.reviewGroupCount ?? payload.duplicateScCount ?? 0))
      const pageCurrencies = Array.from(new Set(rows.map(t => t.currency).filter(Boolean))) as string[]
      if (pageCurrencies.length > 0) {
        setAvailableCurrencies(existing => Array.from(new Set([...existing, ...pageCurrencies])).sort())
      }

      const pendingIds = rows
        .filter(t => t.status === 'PENDING_SC' || t.status === 'PENDING_P')
        .map(t => t.id)
      if (pendingIds.length > 0) {
        void fetch('/api/reconciliation/bulk-match-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactionIds: pendingIds }),
          signal: controller.signal,
        })
          .then(matchResponse => matchResponse.json())
          .then(matchPayload => {
            if (requestId === requestIdRef.current && matchPayload.success) setMatchInfo(matchPayload.data)
          })
          .catch(error => {
            if (error?.name !== 'AbortError') return
          })
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (requestId === requestIdRef.current) {
        setLoadError(error instanceof Error ? error.message : 'تعذر تحميل المعاملات')
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [filters, hideMatched, debouncedSearch, duplicatesOnly, cursor, pageSize, sort])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  const updateFilters: React.Dispatch<React.SetStateAction<Filters>> = next => {
    resetPagination()
    setFilters(next)
  }

  function updateDuplicatesOnly(next: boolean) {
    resetPagination()
    setDuplicatesOnly(next)
  }

  function changePageSize(next: number) {
    resetPagination()
    setPageSize(next)
  }

  function changeSort(next: { key: string; direction: 'asc' | 'desc' }) {
    resetPagination()
    setSort(next)
  }

  function nextPage() {
    if (!nextCursor || loading) return
    setCursorHistory(history => [...history, cursor])
    setCursor(nextCursor)
    setMeta(previous => ({ ...previous, page: previous.page + 1 }))
  }

  function previousPage() {
    if (cursorHistory.length === 0 || loading) return
    const previousCursor = cursorHistory[cursorHistory.length - 1] ?? null
    setCursorHistory(history => history.slice(0, -1))
    setCursor(previousCursor)
    setMeta(previous => ({ ...previous, page: Math.max(1, previous.page - 1) }))
  }

  const columns = buildColumns({
    data,
    restricted,
    matchInfo,
    setEditTx,
    reload: load,
    onDuplicateClick: (sc) => setSearch(sc),
  })

  // Compute totals per currency from displayed data
  const currencyTotals = data.reduce((acc: Record<string, number>, t) => {
    const cur = (t.currency as string) || 'USD'
    acc[cur] = (acc[cur] || 0) + Number(t.amount || 0)
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">المطابقة</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Reconciliation — <span className="font-semibold text-gray-700">{data.length.toLocaleString('ar')}</span> عملية معروضة
            {meta.total > data.length && (
              <span className="text-gray-400"> من أصل {meta.total.toLocaleString('ar')}</span>
            )}
          </p>
        </div>
        {!restricted && Object.keys(currencyTotals).length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(currencyTotals).map(([cur, total]) => (
              <div key={cur} className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2">
                <p className="text-[11px] sm:text-xs text-blue-600 font-bold uppercase tracking-wider">محصل {cur}</p>
                <p className="text-lg font-mono font-bold text-blue-700">
                  {total.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {cur}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Duplicate-SC banner — slim attention strip. Shown only when
          there are unreviewed duplicates and the user isn't already
          inside the duplicates view. */}
      {duplicateScCount > 0 && !duplicatesOnly && (
        <div className="flex items-center gap-2 text-xs bg-red-50 text-red-800 ring-1 ring-red-200 rounded-lg px-3 py-2">
          <AlertTriangle size={13} className="text-red-600 shrink-0" />
          <span className="flex-1">
            <span className="font-bold font-mono">{duplicateScCount.toLocaleString('en')}</span>{' '}
            رقم شام كاش معلّم كتكرار. راجعها قبل أن تتراكم.
          </span>
          <button
            onClick={() => updateDuplicatesOnly(true)}
            className="text-[11px] px-2.5 py-1 rounded-md bg-red-600 text-white hover:bg-red-700 font-semibold shrink-0"
          >
            عرض
          </button>
        </div>
      )}

      {/* Filters */}
      <FilterBar
        filters={filters}
        setFilters={updateFilters}
        accounts={accounts}
        availableCurrencies={availableCurrencies}
        hideMatched={hideMatched ?? true}
        onToggleHideMatched={toggleHideMatched}
        search={search}
        setSearch={setSearch}
        duplicatesOnly={duplicatesOnly}
        setDuplicatesOnly={updateDuplicatesOnly}
        duplicateScCount={duplicateScCount}
      />

      {loadError && (
        <div role="alert" className="card border border-rose-200 bg-rose-50 px-4 py-3 flex items-center justify-between gap-3 text-sm text-rose-800">
          <span>{loadError}</span>
          <button className="btn-secondary btn-sm" onClick={() => void load()}>إعادة المحاولة</button>
        </div>
      )}

      <DataTable
        data={data as unknown as Record<string, unknown>[]}
        columns={columns}
        loading={loading}
        searchable={false}
        pageSize={pageSize}
        pageSizeOptions={[25, 50, 100]}
        getRowId={row => String(row.id)}
        onServerSortChange={changeSort}
        serverSort={sort}
        serverSortableKeys={['txDateTime', 'batch', 'account', 'type', 'status', 'reviewCategory', 'accountName', 'handledByUser', 'shamCashTxId', 'platformTxId', 'platformUserId', 'amount', 'amountDiff', 'source', 'notes']}
        serverPagination={{
          total: meta.total,
          page: meta.page,
          hasNextPage,
          hasPreviousPage: cursorHistory.length > 0,
          onNextPage: nextPage,
          onPreviousPage: previousPage,
          onPageSizeChange: changePageSize,
        }}
        exportFilename="reconciliation"
        tableId="reconciliation"
        excelExportUrl={`/api/transactions/export?${new URLSearchParams(Object.entries(filters).filter(([,v]) => v)).toString()}`}
        emptyMessage="لا توجد عمليات تطابق الفلاتر المحددة"
        emptyHint="جرّب توسيع نطاق البحث أو إزالة بعض الفلاتر."
        emptyAction={
          Object.values(filters).some(Boolean)
            ? {
                label: 'امسح الفلاتر',
                onClick: () => updateFilters({
                  status: '', type: '', accountId: '', currency: '', dateFrom: '', dateTo: '',
                  reviewed: '', reviewCategory: '',
                }),
              }
            : undefined
        }
      />

      {/* Edit Modal */}
      {editTx && (
        <EditModal
          tx={editTx}
          onClose={() => setEditTx(null)}
          onSaved={(warning) => {
            setEditTx(null)
            if (warning) setDupWarning(warning)
            load()
          }}
        />
      )}

      {/* Duplicate-SC toast — fired when PATCH auto-match links a SC
          number that's already used by another matched pair. Seeds the
          search box with the offending number to surface every related
          row in one click. */}
      {dupWarning && (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 sm:left-6 sm:translate-x-0 z-50 w-[min(420px,calc(100vw-2rem))] bg-white rounded-2xl border border-red-200 shadow-2xl shadow-red-100/50 overflow-hidden animate-in slide-in-from-bottom-4"
        >
          <div className="flex items-stretch">
            <div className="bg-red-500 w-1.5 shrink-0" aria-hidden />
            <div className="flex-1 p-4">
              <div className="flex items-start gap-3">
                <div className="bg-red-100 p-1.5 rounded-lg shrink-0">
                  <AlertTriangle size={16} className="text-red-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">رقم شام كاش مكرّر</p>
                  <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                    الرقم <span className="font-mono font-bold text-gray-900">{dupWarning.shamCashTxId}</span> مستخدم في{' '}
                    <span className="font-bold text-red-700">{dupWarning.existingMatches.length}</span> مطابقة سابقة.
                  </p>
                </div>
                <button
                  onClick={() => setDupWarning(null)}
                  className="text-gray-400 hover:text-gray-700 p-1 rounded -mt-1 -mr-1"
                  aria-label="إغلاق"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => {
                    setSearch(dupWarning.shamCashTxId)
                    setDupWarning(null)
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 font-semibold inline-flex items-center gap-1.5"
                >
                  عرض جميع الصفوف
                </button>
                <button
                  onClick={() => setDupWarning(null)}
                  className="text-xs px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 font-medium"
                >
                  لاحقاً
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
