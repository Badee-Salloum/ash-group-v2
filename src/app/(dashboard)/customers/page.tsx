'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import DataTable, { Column } from '@/components/tables/DataTable'
import { CUSTOMER_DIRECTORY_SORT_KEYS } from '@/lib/customers/directorySort'
import { fmtSyria } from '@/lib/datetime'
import { User, Shield, AlertTriangle, TrendingUp } from 'lucide-react'

interface Account { id: string; name: string; currency?: string }

interface Customer extends Record<string, unknown> {
  name: string
  accountIds: string[]
  accountLabels: string[]
  currencies: string[]
  depositCount: number
  depositSum: Record<string, number>
  withdrawalCount: number
  withdrawalSum: Record<string, number>
  balance: Record<string, number>
  discrepancyCount: number
  matchedCount: number
  pendingCount: number
  totalOps: number
  trustScore: number
  firstSeen: string
  lastSeen: string
  lastOpType?: string
  lastOpAmount?: number
  lastOpCurrency?: string
}

function trustStyle(score: number) {
  if (score >= 80) return { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'موثوق' }
  if (score >= 50) return { cls: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'متوسط' }
  return { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'منخفض' }
}

function fmtMulti(obj: Record<string, number>) {
  const keys = Object.keys(obj)
  if (keys.length === 0) return '—'
  return keys.map(k => `${Number(obj[k]).toLocaleString('en', { minimumFractionDigits: 2 })} ${k}`).join(' · ')
}

export default function CustomersPage() {
  const [data, setData] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [filters, setFilters] = useState({ accountId: '', currency: '', dateFrom: '', dateTo: '' })
  const [availableCurrencies, setAvailableCurrencies] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ key: 'lastSeen', direction: 'desc' as 'asc' | 'desc' })
  const [sortCurrency, setSortCurrency] = useState('USD')
  const [cursor, setCursor] = useState<string | null>(null)
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loadError, setLoadError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const requestId = ++requestIdRef.current
    setLoading(true)
    setLoadError('')
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v))
    if (search) params.set('search', search)
    params.set('limit', String(pageSize))
    params.set('sortBy', sort.key)
    params.set('sortDir', sort.direction)
    params.set('sortCurrency', sortCurrency)
    if (cursor) params.set('cursor', cursor)
    try {
      const response = await fetch(`/api/customers/query?${params}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'تعذر تحميل العملاء')
      if (requestId !== requestIdRef.current) return

      const rows = (payload.data || []) as Customer[]
      const pageInfo = payload.pageInfo as { total?: number; nextCursor?: string | null; hasNext?: boolean }
      setData(rows)
      setTotal(Number(pageInfo?.total ?? 0))
      setNextCursor(pageInfo?.nextCursor ?? null)
      setHasNextPage(Boolean(pageInfo?.hasNext))
      const curs = Array.from(new Set(rows.flatMap(customer => customer.currencies))) as string[]
      if (curs.length > 0) {
        setAvailableCurrencies(existing => Array.from(new Set([...existing, ...curs])).sort())
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (requestId === requestIdRef.current) {
        setLoadError(error instanceof Error ? error.message : 'تعذر تحميل العملاء')
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [filters, search, cursor, pageSize, sort, sortCurrency])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/accounts', { signal: controller.signal }).then(r => r.json()).then(d => {
      if (!d.success) return
      const accountRows: Account[] = d.data.map((a: Account) => ({ id: a.id, name: a.name, currency: a.currency }))
      const accountCurrencies = accountRows
        .map((account: Account) => account.currency)
        .filter((currency): currency is string => Boolean(currency))
      setAccounts(accountRows)
      setAvailableCurrencies(existing => Array.from(new Set([...existing, ...accountCurrencies])).sort())
    }).catch(() => {})
    return () => controller.abort()
  }, [])

  const resetPagination = useCallback(() => {
    setCursor(null)
    setCursorHistory([])
    setNextCursor(null)
    setHasNextPage(false)
    setPage(1)
  }, [])

  const setFilter = useCallback((k: keyof typeof filters, v: string) => {
    resetPagination()
    setFilters(f => ({ ...f, [k]: v }))
  }, [resetPagination])

  const updateSearch = useCallback((next: string) => {
    resetPagination()
    setSearch(next)
  }, [resetPagination])

  function changePageSize(next: number) {
    resetPagination()
    setPageSize(next)
  }

  function nextPage() {
    if (!nextCursor || loading) return
    setCursorHistory(history => [...history, cursor])
    setCursor(nextCursor)
    setPage(current => current + 1)
  }

  function previousPage() {
    if (cursorHistory.length === 0 || loading) return
    const previousCursor = cursorHistory[cursorHistory.length - 1] ?? null
    setCursorHistory(history => history.slice(0, -1))
    setCursor(previousCursor)
    setPage(current => Math.max(1, current - 1))
  }

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: 'العميل',
      render: c => (
        <Link
          href={`/customers/${encodeURIComponent(c.name)}`}
          className="flex items-center gap-2 group"
        >
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-medium text-xs shrink-0">
            {c.name.charAt(0)}
          </div>
          <div>
            <p className="font-medium text-gray-900 group-hover:text-brand-600 transition-colors">{c.name}</p>
            <p className="text-[10px] text-gray-400">{c.accountLabels.join(' · ')}</p>
          </div>
        </Link>
      ),
    },
    {
      key: 'trustScore',
      header: 'موثوقية',
      render: c => {
        const s = trustStyle(c.trustScore)
        return (
          <span className={`badge ${s.cls} ring-1 font-bold`}>
            <Shield size={10} /> {c.trustScore}% {s.label}
          </span>
        )
      },
    },
    {
      key: 'totalOps',
      header: 'العمليات',
      render: c => (
        <div className="text-xs">
          <div className="font-semibold text-gray-700">{c.totalOps} إجمالي</div>
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <span className="text-emerald-600">↓{c.depositCount}</span>
            <span className="text-sky-600">↑{c.withdrawalCount}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'depositSum',
      header: 'إجمالي الإيداعات',
      sortAccessor: c => c.depositSum[filters.currency || sortCurrency] || 0,
      render: c => <span className="font-mono text-xs text-emerald-700">{fmtMulti(c.depositSum)}</span>,
    },
    {
      key: 'withdrawalSum',
      header: 'إجمالي السحوبات',
      sortAccessor: c => c.withdrawalSum[filters.currency || sortCurrency] || 0,
      render: c => <span className="font-mono text-xs text-sky-700">{fmtMulti(c.withdrawalSum)}</span>,
    },
    {
      key: 'balance',
      header: 'الرصيد (إيداع - سحب)',
      sortAccessor: c => c.balance[filters.currency || sortCurrency] || 0,
      render: c => {
        const entries = Object.entries(c.balance)
        if (entries.length === 0) return '—'
        return (
          <div className="font-mono text-xs space-y-0.5">
            {entries.map(([cur, v]) => (
              <div key={cur} className={v >= 0 ? 'text-emerald-700 font-semibold' : 'text-rose-600 font-semibold'}>
                {Number(v).toLocaleString('en', { minimumFractionDigits: 2 })} {cur}
              </div>
            ))}
          </div>
        )
      },
    },
    {
      key: 'discrepancyCount',
      header: 'مشاكل',
      render: c => (
        c.discrepancyCount > 0
          ? <span className="badge bg-rose-50 text-rose-700 ring-1 ring-rose-200">
              <AlertTriangle size={10} /> {c.discrepancyCount} فارق
            </span>
          : <span className="text-gray-300 text-xs">—</span>
      ),
    },
    {
      key: 'lastSeen',
      header: 'آخر عملية',
      render: c => (
        <div className="text-xs">
          <div className="font-mono text-gray-600">{fmtSyria(c.lastSeen, false)}</div>
        </div>
      ),
    },
  ]

  const totalCustomers = data.length
  const trustedCount = data.filter(c => c.trustScore >= 80).length
  const problematicCount = data.filter(c => c.discrepancyCount > 0).length
  const totalOps = data.reduce((s, c) => s + c.totalOps, 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">العملاء</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Customers — تتبّع كامل لكل عميل وسجله مع الحسابات
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-gray-400 font-bold uppercase">عملاء الصفحة الحالية</p>
            <User size={14} className="text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-gray-800 font-mono">{totalCustomers}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-emerald-500 font-bold uppercase">موثوقون 80%+ (الصفحة)</p>
            <Shield size={14} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-700 font-mono">{trustedCount}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-rose-500 font-bold uppercase">مشاكل (الصفحة)</p>
            <AlertTriangle size={14} className="text-rose-500" />
          </div>
          <p className="text-2xl font-bold text-rose-700 font-mono">{problematicCount}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-gray-400 font-bold uppercase">عمليات الصفحة</p>
            <TrendingUp size={14} className="text-gray-500" />
          </div>
          <p className="text-2xl font-bold text-gray-800 font-mono">{totalOps.toLocaleString('en')}</p>
        </div>
      </div>

      <div className="card p-3 sm:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          <select className="input text-sm" value={filters.accountId} onChange={e => setFilter('accountId', e.target.value)}>
            <option value="">كل الحسابات</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="input text-sm" value={filters.currency} onChange={e => setFilter('currency', e.target.value)}>
            <option value="">كل العملات</option>
            {availableCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="date" className="input text-sm" value={filters.dateFrom}
            onChange={e => setFilter('dateFrom', e.target.value)} />
          <input type="date" className="input text-sm" value={filters.dateTo}
            onChange={e => setFilter('dateTo', e.target.value)} />
        </div>
      </div>

      {loadError && (
        <div role="alert" className="card border border-rose-200 bg-rose-50 px-4 py-3 flex items-center justify-between gap-3 text-sm text-rose-800">
          <span>{loadError}</span>
          <button className="btn-secondary btn-sm" onClick={() => void load()}>إعادة المحاولة</button>
        </div>
      )}

      {!filters.currency && <label className="flex items-center gap-2 text-xs text-gray-500">
        عملة فرز المبالغ (دون تحويل العملات):
        <select className="input w-auto text-xs" value={sortCurrency} onChange={e => { resetPagination(); setSortCurrency(e.target.value) }}>
          {Array.from(new Set(['USD', 'SYP', ...availableCurrencies])).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>}

      <DataTable
        data={data}
        columns={columns}
        loading={loading}
        pageSize={pageSize}
        pageSizeOptions={[25, 50, 100]}
        getRowId={customer => customer.name}
        onServerSearchChange={updateSearch}
        serverSort={sort}
        serverSortableKeys={CUSTOMER_DIRECTORY_SORT_KEYS}
        onServerSortChange={next => { resetPagination(); setSort(next) }}
        serverPagination={{
          total,
          page,
          hasNextPage,
          hasPreviousPage: cursorHistory.length > 0,
          onNextPage: nextPage,
          onPreviousPage: previousPage,
          onPageSizeChange: changePageSize,
        }}
        exportFilename="customers"
        tableId="customers"
        emptyMessage="لا يوجد عملاء في النطاق المحدد"
      />
    </div>
  )
}
