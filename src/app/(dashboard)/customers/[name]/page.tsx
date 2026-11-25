'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import DataTable, { Column } from '@/components/tables/DataTable'
import { fmtSyria } from '@/lib/datetime'
import { ArrowRight, TrendingUp, TrendingDown, Shield, AlertTriangle, User, Fingerprint } from 'lucide-react'
import TransactionRowActions, {
  type TransactionStatus,
  type ReviewCategory,
} from '@/components/forms/TransactionRowActions'
import { BatchTraceBadge, BatchTraceInfo } from '@/components/ui/BatchTraceBadge'
import { CUSTOMER_TX_SORT_KEYS, type CustomerTxSort } from '@/lib/customers/transactionSort'

interface TxRow extends Record<string, unknown> {
  id: string
  accountId: string
  accountLabel: string
  type: string
  status: TransactionStatus
  source: string
  amount: number
  currency: string
  txDateTime: string
  shamCashTxId: string | null
  platformTxId: string | null
  platformUserId: string | null
  amountDiff: number | null
  matchedTxId: string | null
  reviewCategory: ReviewCategory
  reviewNotes: string | null
  notes: string | null
  batch?: BatchTraceInfo | null
}

interface CustomerSummary {
  depositCount: number
  depositSum: Record<string, number>
  withdrawalCount: number
  withdrawalSum: Record<string, number>
  balance: Record<string, number>
  matchedCount: number
  discrepancyCount: number
  totalOps: number
  trustScore: number
}

const EMPTY_SUMMARY: CustomerSummary = {
  depositCount: 0,
  depositSum: {},
  withdrawalCount: 0,
  withdrawalSum: {},
  balance: {},
  matchedCount: 0,
  discrepancyCount: 0,
  totalOps: 0,
  trustScore: 0,
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  MATCHED:     { label: 'مطابقة',      cls: 'badge-matched' },
  PENDING_SC:  { label: 'شام كاش فقط', cls: 'badge-pending-sc' },
  PENDING_P:   { label: 'المنصة فقط',  cls: 'badge-pending-p' },
  DISCREPANCY: { label: 'فارق',        cls: 'badge-discrepancy' },
  WASTE:       { label: 'هدر',         cls: 'badge-waste' },
  RETURNS:     { label: 'مرتجعات',     cls: 'badge-returns' },
}

export default function CustomerDetailPage() {
  const params = useParams<{ name: string }>()
  const router = useRouter()
  const name = decodeURIComponent(params?.name || '')
  const [data, setData] = useState<TxRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [summary, setSummary] = useState<CustomerSummary>(EMPTY_SUMMARY)
  const [platformUserIds, setPlatformUserIds] = useState<string[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [sort, setSort] = useState<CustomerTxSort>({ key: 'txDateTime', direction: 'desc' })
  const [searchTerm, setSearchTerm] = useState('')
  const [userRole, setUserRole] = useState<string>('')
  const abortRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  // Default-hide MATCHED rows (per user request); persisted under the same
  // /api/me/preferences slot as the reconciliation toggle.
  const [hideMatched, setHideMatched] = useState<boolean | null>(null)
  const effectiveHideMatched = hideMatched ?? true

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const requestId = ++requestIdRef.current
    setLoading(true)
    setLoadError('')
    const search = new URLSearchParams({
      limit: String(pageSize), sortBy: sort.key, sortDir: sort.direction, hideMatched: String(effectiveHideMatched),
    })
    if (searchTerm) search.set('search', searchTerm)
    if (cursor) search.set('cursor', cursor)
    try {
      const response = await fetch(`/api/customers/${encodeURIComponent(name)}?${search}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'تعذر تحميل العميل')
      if (requestId !== requestIdRef.current) return
      if (payload.redirectName && payload.redirectName !== name) {
        router.replace(`/customers/${encodeURIComponent(payload.redirectName)}`)
        return
      }
      setData((payload.data || []) as TxRow[])
      setSummary((payload.summary || EMPTY_SUMMARY) as CustomerSummary)
      setPlatformUserIds((payload.meta?.userIds || []) as string[])
      setTotal(Number(payload.pageInfo?.total || 0))
      setNextCursor(payload.pageInfo?.nextCursor || null)
      setHasNextPage(Boolean(payload.pageInfo?.hasNext))
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (requestId === requestIdRef.current) {
        setLoadError(error instanceof Error ? error.message : 'تعذر تحميل العميل')
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [name, router, cursor, pageSize, sort, searchTerm, effectiveHideMatched])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  useEffect(() => {
    setCursor(null)
    setCursorHistory([])
    setNextCursor(null)
    setHasNextPage(false)
    setPage(1)
  }, [name])

  // Fetch session role once so we can hide the actions menu for roles that
  // can't mutate transactions (everyone below ACCOUNTANT).
  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(d => { if (d?.role) setUserRole(d.role) })
      .catch(() => undefined)
    fetch('/api/me/preferences').then(r => r.json()).then(d => {
      const saved = d?.data?.hideMatched?.customers
      setHideMatched(saved === false ? false : true)
      if (saved === false) resetPage()
    }).catch(() => setHideMatched(true))
  }, [])

  function toggleHideMatched() {
    const next = !(hideMatched ?? true)
    setHideMatched(next)
    resetPage()
    fetch('/api/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hideMatched: { customers: next } }),
    }).catch(() => {})
  }

  // Apply hide-MATCHED filter. INTERNAL_TRANSFER stays visible — its badge
  // already overrides the status column.
  function nextPage() {
    if (!nextCursor || loading) return
    setCursorHistory(history => [...history, cursor])
    setCursor(nextCursor)
    setPage(current => current + 1)
  }

  function previousPage() {
    if (cursorHistory.length === 0 || loading) return
    const previous = cursorHistory[cursorHistory.length - 1] ?? null
    setCursorHistory(history => history.slice(0, -1))
    setCursor(previous)
    setPage(current => Math.max(1, current - 1))
  }

  function changePageSize(next: number) {
    resetPage()
    setPageSize(next)
  }

  function resetPage() {
    setCursor(null)
    setCursorHistory([])
    setNextCursor(null)
    setHasNextPage(false)
    setPage(1)
  }

  const changeSearch = useCallback((next: string) => {
    setSearchTerm(next)
    resetPage()
  }, [])

  function changeSort(next: { key: string; direction: 'asc' | 'desc' }) {
    if (!CUSTOMER_TX_SORT_KEYS.includes(next.key as CustomerTxSort['key'])) return
    resetPage()
    setSort(next as CustomerTxSort)
  }

  const visible = (hideMatched ?? true)
    ? data.filter(r => !(r.status === 'MATCHED' && r.reviewCategory !== 'INTERNAL_TRANSFER'))
    : data

  // The endpoint aggregates across the complete customer set. The table only
  // receives the current page, so these figures do not change with paging.
  const {
    depositSum: depositTotal,
    withdrawalSum: withdrawalTotal,
    balance,
    depositCount: depCount,
    withdrawalCount: wdCount,
    discrepancyCount: discCount,
    totalOps,
    trustScore,
  } = summary

  /* Legacy page-only aggregate retained in history; the server summary above
   * is the source of truth for cursor-paginated data.
   // Collect distinct platform USER IDs for this customer
  const platformUserIds = Array.from(
    new Set(data.map(t => t.platformUserId).filter((x): x is string => !!x && x !== '—'))
  )
  const totalOps = depCount + wdCount
  const trustScore = totalOps > 0
    ? Math.max(0, Math.round((matchCount / totalOps) * 100 - (discCount / totalOps) * 20))
    : 0

  */
  const columns: Column<TxRow>[] = [
    {
      key: 'txDateTime',
      header: 'التاريخ',
      render: r => (
        <span className="text-xs font-mono text-gray-600">
          {fmtSyria(r.txDateTime)}
        </span>
      ),
    },
    {
      key: 'batch',
      header: 'الرفعة',
      sortable: false,
      render: r => <BatchTraceBadge batch={r.batch ?? null} />,
    },
    {
      key: 'accountLabel',
      header: 'الحساب',
      render: r => <span className="text-sm">{r.accountLabel || '—'}</span>,
    },
    {
      key: 'type',
      header: 'النوع',
      render: r => r.type === 'DEPOSIT' ? '↓ إيداع' : '↑ سحب',
    },
    {
      key: 'status',
      header: 'الحالة',
      render: r => {
        // Reviewer-flagged internal transfers override the raw status badge.
        if (r.reviewCategory === 'INTERNAL_TRANSFER') {
          return <span className="badge bg-slate-200 text-slate-800 ring-slate-300">تحويل داخلي</span>
        }
        const s = STATUS_LABELS[r.status] || { label: r.status, cls: 'badge-waste' }
        return <span className={`badge ${s.cls}`}>{s.label}</span>
      },
    },
    {
      key: 'amount',
      header: 'المبلغ',
      render: r => (
        <span className="font-mono font-medium">
          {Number(r.amount).toLocaleString('en', { minimumFractionDigits: 2 })} {r.currency}
        </span>
      ),
    },
    {
      key: 'amountDiff',
      header: 'الفارق',
      render: r => r.amountDiff
        ? <span className="text-red-600 font-mono text-sm font-bold">
            {Number(r.amountDiff).toLocaleString('en', { minimumFractionDigits: 2 })}
          </span>
        : '—',
    },
    {
      key: 'shamCashTxId',
      header: 'رقم شام كاش',
      render: r => <span className="font-mono text-xs">{r.shamCashTxId || '—'}</span>,
    },
    {
      key: 'platformTxId',
      header: 'رقم المنصة',
      render: r => <span className="font-mono text-xs">{r.platformTxId || '—'}</span>,
    },
    {
      key: 'platformUserId',
      header: 'USER ID',
      render: r => r.platformUserId
        ? <span className="font-mono text-xs text-blue-700">{r.platformUserId}</span>
        : <span className="text-gray-400">—</span>,
    },
    {
      key: 'notes',
      header: 'ملاحظات',
      render: r => {
        const txt = r.notes || ''
        return txt ? <span className="text-xs text-gray-500">{txt.slice(0, 50)}</span> : '—'
      },
    },
    {
      key: 'actions',
      header: '',
      sortable: false,
      render: r => (
        <TransactionRowActions
          row={{
            id: r.id,
            status: r.status,
            type: r.type,
            source: r.source,
            amount: r.amount,
            currency: r.currency,
            matchedTxId: r.matchedTxId,
            reviewCategory: r.reviewCategory,
            reviewNotes: r.reviewNotes,
            notes: r.notes,
          }}
          userRole={userRole}
          onRefresh={load}
        />
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/customers" className="btn-secondary btn-sm">
          <ArrowRight size={14} /> العملاء
        </Link>
      </div>

      {/* Customer header */}
      <div className="card p-5">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white text-xl font-bold flex items-center justify-center shrink-0">
            {name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900">{name}</h1>
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
              <User size={12} /> {totalOps} عملية إجمالاً
            </p>
            {platformUserIds.length > 0 && (
              <div className="mt-2 flex items-start gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400 mt-1">
                  <Fingerprint size={11} /> USER ID:
                </span>
                {platformUserIds.map(uid => (
                  <span
                    key={uid}
                    className="badge bg-blue-50 text-blue-700 ring-1 ring-blue-200 font-mono text-[11px]"
                    title="USER ID الخاص بالمنصة"
                  >
                    {uid}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            {(() => {
              const cs = trustScore >= 80
                ? { cls: 'text-emerald-700 bg-emerald-50 ring-emerald-200', label: 'موثوق' }
                : trustScore >= 50
                ? { cls: 'text-amber-700 bg-amber-50 ring-amber-200', label: 'متوسط' }
                : { cls: 'text-red-700 bg-red-50 ring-red-200', label: 'منخفض' }
              return (
                <div className={`rounded-xl px-4 py-3 ring-1 ${cs.cls}`}>
                  <div className="flex items-center gap-2">
                    <Shield size={14} />
                    <span className="font-bold text-sm">{cs.label}</span>
                  </div>
                  <p className="text-2xl font-extrabold font-mono mt-0.5">{trustScore}%</p>
                  <p className="text-[10px] font-bold uppercase">موثوقية</p>
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Summary grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-emerald-500 font-bold uppercase">الإيداعات</p>
            <TrendingUp size={14} className="text-emerald-500" />
          </div>
          <p className="text-lg font-bold text-emerald-700 font-mono">
            {Object.entries(depositTotal).map(([c, v]) => (
              <span key={c} className="block text-sm">
                {v.toLocaleString('en', { minimumFractionDigits: 2 })} {c}
              </span>
            ))}
            {Object.keys(depositTotal).length === 0 && <span className="text-gray-400">—</span>}
          </p>
          <p className="text-[10px] text-gray-400 mt-1">{depCount} عملية</p>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-sky-500 font-bold uppercase">السحوبات</p>
            <TrendingDown size={14} className="text-sky-500" />
          </div>
          <p className="text-lg font-bold text-sky-700 font-mono">
            {Object.entries(withdrawalTotal).map(([c, v]) => (
              <span key={c} className="block text-sm">
                {v.toLocaleString('en', { minimumFractionDigits: 2 })} {c}
              </span>
            ))}
            {Object.keys(withdrawalTotal).length === 0 && <span className="text-gray-400">—</span>}
          </p>
          <p className="text-[10px] text-gray-400 mt-1">{wdCount} عملية</p>
        </div>

        <div className="card p-4">
          <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">الرصيد</p>
          <div className="text-lg font-bold font-mono">
            {Object.entries(balance).map(([c, v]) => (
              <span key={c} className={`block text-sm ${v >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                {v.toLocaleString('en', { minimumFractionDigits: 2 })} {c}
              </span>
            ))}
            {Object.keys(balance).length === 0 && <span className="text-gray-400">—</span>}
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-rose-500 font-bold uppercase">مشاكل</p>
            <AlertTriangle size={14} className="text-rose-500" />
          </div>
          <p className="text-2xl font-bold text-rose-700 font-mono">{discCount}</p>
          <p className="text-[10px] text-gray-400 mt-1">عملية بفارق</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">العرض:</span>
        <button
          onClick={toggleHideMatched}
          title={(hideMatched ?? true)
            ? 'المطابقات الكاملة مخفية الآن — اضغط لإظهارها'
            : 'المطابقات الكاملة معروضة الآن — اضغط لإخفائها'}
          className={`text-xs px-3 py-1.5 rounded-lg ring-1 transition-colors font-medium ${
            (hideMatched ?? true)
              ? 'bg-slate-100 text-slate-700 ring-slate-300'
              : 'bg-white text-gray-600 ring-gray-200 hover:bg-slate-50 hover:text-slate-700 hover:ring-slate-200'
          }`}
        >
          {(hideMatched ?? true) ? 'إظهار المطابقات' : 'إخفاء المطابقات'}
        </button>
        <span className="text-xs text-gray-400">
          {visible.length.toLocaleString('ar')} من أصل {data.length.toLocaleString('ar')} عملية
        </span>
      </div>

      {loadError && (
        <div role="alert" className="card border border-rose-200 bg-rose-50 px-4 py-3 flex items-center justify-between gap-3 text-sm text-rose-800">
          <span>{loadError}</span>
          <button className="btn-secondary btn-sm" onClick={() => void load()}>Retry</button>
        </div>
      )}

      <DataTable
        data={visible}
        columns={columns}
        loading={loading}
        onServerSortChange={changeSort}
        serverSort={sort}
        serverSortableKeys={CUSTOMER_TX_SORT_KEYS}
        onServerSearchChange={changeSearch}
        pageSize={pageSize}
        pageSizeOptions={[25, 50, 100]}
        getRowId={row => row.id}
        serverPagination={{
          total,
          page,
          hasNextPage,
          hasPreviousPage: cursorHistory.length > 0,
          onNextPage: nextPage,
          onPreviousPage: previousPage,
          onPageSizeChange: changePageSize,
        }}
        exportFilename={`customer-${name}`}
        tableId="customer-transactions"
        emptyMessage="لا توجد عمليات لهذا العميل"
      />
    </div>
  )
}
