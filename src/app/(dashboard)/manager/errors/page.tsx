'use client'
import { SortableTable, type TableSort } from '@/components/tables/SortableTable'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Loader2, RefreshCw, CheckCircle2, XCircle, ChevronDown, ChevronUp, ExternalLink, AlertOctagon,
} from 'lucide-react'
import { fmtSyriaDate, fmtSyria } from '@/lib/datetime'
import { PageHeader } from '@/components/ui/PageHeader'

interface Row {
  id: string
  name: string
  employeeCode: string | null
  avatarUrl: string | null
  handled: number
  errors: number
  ratio: number
  errorAmounts: Record<string, number>
  delays: number
  bonusStatus: 'ok' | 'blocked'
  breaches: string[]
}

interface Thresholds {
  ratioLimit: number
  amountLimits: Record<string, number>
  delayLimit: number
}

interface ErrorTx {
  id: string
  txDateTime: string
  shamCashTxId: string | null
  platformTxId: string | null
  amount: string
  currency: string
  reviewCategory: string | null
  displayNotes: string | null
  reviewedAt: string | null
  reviewerName: string | null
  account: { name: string } | null
}

const CATEGORY_LABEL: Record<string, string> = {
  EMPLOYEE_ERROR: 'خطأ موظف',
  THEFT: 'سرقة',
}

function toISO(d: Date) { return d.toISOString().slice(0, 10) }

export default function ManagerErrorsPage() {
  const today = new Date()
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 6); return toISO(d)
  })
  const [to, setTo] = useState(toISO(today))
  const [rows, setRows] = useState<Row[]>([])
  const [thresholds, setThresholds] = useState<Thresholds | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Client-side filters — applied on top of the fetched rows.
  const [searchName, setSearchName] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'blocked'>('all')

  function preset(days: number) {
    const d = new Date(); d.setDate(d.getDate() - days + 1)
    setFrom(toISO(d))
    setTo(toISO(today))
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/manager/errors?from=${from}&to=${to}`).then(r => r.json())
      if (res.success) {
        setRows(res.rows)
        setThresholds(res.thresholds)
        // Reset drill-down cache so re-expansion refetches for the new
        // window instead of showing stale rows.
        setExpanded(new Set())
      }
    } finally { setLoading(false) }
  }, [from, to])

  useEffect(() => { load() }, [load])

  async function toggle(employeeId: string) {
    const next = new Set(expanded)
    if (next.has(employeeId)) {
      next.delete(employeeId)
      setExpanded(next)
      return
    }
    next.add(employeeId)
    setExpanded(next)
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        icon={<AlertOctagon size={20} />}
        title="أخطاء الموظفين"
        subtitle={`من ${fmtSyriaDate(from)} إلى ${fmtSyriaDate(to)}. اضغط أي صف لعرض العمليات الخاطئة.`}
        actions={
          <>
            <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-[11px]">
              {[
                { label: 'هذا الأسبوع', days: 7 },
                { label: '30 يوم', days: 30 },
                { label: 'هذا الشهر', days: 30 },
              ].map(p => (
                <button
                  key={p.label}
                  onClick={() => preset(p.days)}
                  className="px-2 py-1 rounded-md text-gray-600 hover:bg-white"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input type="date" className="input py-1 text-sm" value={from} onChange={e => setFrom(e.target.value)} aria-label="من تاريخ" />
            <span className="text-gray-400 text-xs">←</span>
            <input type="date" className="input py-1 text-sm" value={to} onChange={e => setTo(e.target.value)} aria-label="إلى تاريخ" />
            <button onClick={load} className="btn-secondary btn-sm">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              تحديث
            </button>
          </>
        }
      />

      {/* Client-side filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="search"
          className="input py-1 text-sm max-w-xs"
          placeholder="بحث بالاسم أو رمز الموظف"
          value={searchName}
          onChange={e => setSearchName(e.target.value)}
        />
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-[11px]">
          {[
            { v: 'all', l: 'الكل' },
            { v: 'blocked', l: 'محظور فقط' },
            { v: 'ok', l: 'مؤهّل فقط' },
          ].map(o => (
            <button
              key={o.v}
              onClick={() => setStatusFilter(o.v as 'all' | 'ok' | 'blocked')}
              className={`px-2 py-1 rounded-md ${statusFilter === o.v ? 'bg-white shadow-sm font-bold' : 'text-gray-600'}`}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {thresholds && (
        <div className="card p-3 flex items-center gap-3 flex-wrap text-xs bg-blue-50/40">
          <span className="font-semibold text-gray-700">الحدود النشطة:</span>
          <span>نسبة الأخطاء ≤ <span className="font-mono font-bold">{(thresholds.ratioLimit * 100).toFixed(3)}%</span></span>
          <span>·</span>
          <span>
            قيم الأخطاء ≤ {Object.entries(thresholds.amountLimits).map(([c, v]) => `${v.toLocaleString('en')} ${c}`).join(' · ')}
          </span>
          <span>·</span>
          <span>التأخيرات ≤ <span className="font-mono font-bold">{thresholds.delayLimit}</span></span>
        </div>
      )}

      <div className="card overflow-x-auto">
        <SortableTable className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-right font-semibold text-gray-600 w-8"></th>
              <th className="px-3 py-2 text-right font-semibold text-gray-600">الموظف</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-600">العمليات</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-600">الأخطاء</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-600">النسبة %</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-600">قيم الأخطاء</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-600">تأخيرات</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-600">حالة المكافأة</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="p-12 text-center text-gray-400"><Loader2 size={20} className="animate-spin mx-auto" /></td></tr>
            ) : (() => {
              // Apply client-side name + status filters here so we don't
              // re-issue the whole aggregation query for each toggle.
              const filtered = rows.filter(r => {
                if (statusFilter !== 'all' && r.bonusStatus !== statusFilter) return false
                if (searchName.trim()) {
                  const q = searchName.trim().toLowerCase()
                  if (!r.name.toLowerCase().includes(q) && !(r.employeeCode ?? '').toLowerCase().includes(q)) {
                    return false
                  }
                }
                return true
              })
              if (filtered.length === 0) {
                return <tr><td colSpan={8} className="p-12 text-center text-gray-400">لا موظفون يطابقون الفلاتر.</td></tr>
              }
              return filtered.flatMap(r => {
              const isOpen = expanded.has(r.id)
              return [
                <tr
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  aria-controls={`error-detail-${r.id}`}
                  className={`border-t border-gray-100 cursor-pointer hover:bg-blue-50/30 focus:bg-blue-50/50 focus:outline-none ${r.bonusStatus === 'blocked' ? 'bg-rose-50/30' : ''}`}
                  onClick={() => toggle(r.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault(); toggle(r.id)
                    }
                  }}
                >
                  <td className="px-3 py-2 text-center text-gray-400">
                    {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </td>
                  <td data-sort-value={r.name} className="px-3 py-2">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{r.employeeCode ?? '—'}</p>
                  </td>
                  <td className="px-3 py-2 text-center font-mono">{r.handled}</td>
                  <td className="px-3 py-2 text-center font-mono text-rose-700">{r.errors}</td>
                  <td className={`px-3 py-2 text-center font-mono ${thresholds && r.ratio > thresholds.ratioLimit * 100 ? 'text-rose-700 font-bold' : ''}`}>
                    {r.ratio.toFixed(2)}
                  </td>
                  <td data-sort-value={r.errorAmounts} className="px-3 py-2 text-center font-mono text-xs">
                    {Object.entries(r.errorAmounts).length === 0 ? '—' : Object.entries(r.errorAmounts).map(([c, v]) => (
                      <span key={c} className={`inline-block mr-1 ${thresholds && v > (thresholds.amountLimits[c] ?? Infinity) ? 'text-rose-700 font-bold' : ''}`}>
                        {v.toLocaleString('en')} {c}
                      </span>
                    ))}
                  </td>
                  <td className={`px-3 py-2 text-center font-mono ${r.delays > 0 ? 'text-amber-700' : ''}`}>{r.delays}</td>
                  <td className="px-3 py-2 text-center">
                    {r.bonusStatus === 'ok' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                        <CheckCircle2 size={11} /> مؤهّل
                      </span>
                    ) : (
                      <div className="inline-flex items-center gap-1 flex-wrap justify-center">
                        <span className="inline-flex items-center gap-1 text-[11px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">
                          <XCircle size={11} /> محظور
                        </span>
                        {r.breaches.map(b => (
                          <span key={b} className="text-[10px] bg-rose-50 text-rose-600 ring-1 ring-rose-200 px-1.5 py-0.5 rounded">
                            {b}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>,
                isOpen && (
                  <tr key={`${r.id}-detail`} id={`error-detail-${r.id}`} className="border-t border-gray-100 bg-gray-50/60">
                    <td colSpan={8} className="p-3">
                      <ErrorDetail employeeId={r.id} from={from} to={to} />
                    </td>
                  </tr>
                ),
              ]
            })
            })()}
          </tbody>
        </SortableTable>
      </div>
    </div>
  )
}

function ErrorDetail({ employeeId, from, to }: { employeeId: string; from: string; to: string }) {
  const [rows, setRows] = useState<ErrorTx[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sort, setSort] = useState<TableSort>({ index: 0, direction: 'desc' })
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const keys = ['txDateTime', 'account', 'shamCashTxId', 'platformTxId', 'amount', 'reviewCategory', 'displayNotes', 'reviewerName']
    const params = new URLSearchParams({ employeeId, from, to, sortBy: keys[sort.index], sortDir: sort.direction, page: String(page) })
    setLoading(true); setError('')
    void fetch('/api/manager/errors/transactions?' + params, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'تعذر تحميل العمليات')
      if (!controller.signal.aborted) { setRows(payload.rows); setTotalPages(payload.meta?.totalPages || 1) }
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'تعذر التحميل') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [employeeId, from, to, sort, page, retry])

  return (
    <div className="overflow-x-auto">
      {error && <p role="alert" className="text-xs text-red-600">{error} <button onClick={() => setRetry(n => n + 1)}>إعادة المحاولة</button></p>}
      {loading && <p role="status" className="text-xs text-gray-500">جارٍ تحديث العمليات…</p>}
      <SortableTable className="w-full text-xs bg-white rounded-lg" sort={sort} onSortChange={next => { setPage(1); setSort(next) }} sortableIndexes={[0, 1, 2, 3, 4, 5, 6, 7]}>
        <thead className="bg-slate-100 text-gray-600">
          <tr>
            <th className="px-2 py-1.5 text-right font-semibold">التاريخ</th>
            <th className="px-2 py-1.5 text-right font-semibold">الحساب</th>
            <th className="px-2 py-1.5 text-right font-semibold">SC</th>
            <th className="px-2 py-1.5 text-right font-semibold">المنصة</th>
            <th className="px-2 py-1.5 text-center font-semibold">المبلغ</th>
            <th className="px-2 py-1.5 text-center font-semibold">النوع</th>
            <th className="px-2 py-1.5 text-right font-semibold">الملاحظات</th>
            <th className="px-2 py-1.5 text-right font-semibold">راجعها</th>
            <th className="px-2 py-1.5 text-center font-semibold"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(t => (
            <tr key={t.id} className="border-t border-slate-100">
              <td data-sort-value={t.txDateTime} className="px-2 py-1.5 text-[10px] text-gray-500">{fmtSyria(t.txDateTime)}</td>
              <td className="px-2 py-1.5">{t.account?.name ?? '—'}</td>
              <td className="px-2 py-1.5 font-mono">{t.shamCashTxId ?? '—'}</td>
              <td className="px-2 py-1.5 font-mono">{t.platformTxId ?? '—'}</td>
              <td className="px-2 py-1.5 text-center font-mono">
                {Number(t.amount).toLocaleString('en')} {t.currency}
              </td>
              <td className="px-2 py-1.5 text-center">
                {t.reviewCategory && (
                  <span className="text-[10px] bg-rose-100 text-rose-700 rounded px-1.5 py-0.5">
                    {CATEGORY_LABEL[t.reviewCategory] ?? t.reviewCategory}
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 text-gray-600 max-w-[240px] truncate" title={t.displayNotes ?? ''}>
                {t.displayNotes ?? '—'}
              </td>
              <td className="px-2 py-1.5 text-[10px] text-gray-500">
                {t.reviewerName ?? '—'}
                {t.reviewedAt && (
                  <div className="text-gray-400">{fmtSyria(t.reviewedAt)}</div>
                )}
              </td>
              <td className="px-2 py-1.5 text-center">
                {(t.shamCashTxId || t.platformTxId) && (
                  <Link
                    href={`/reconciliation?search=${encodeURIComponent(t.shamCashTxId || t.platformTxId || '')}`}
                    className="text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                    title="فتح في المطابقة"
                  >
                    <ExternalLink size={11} />
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </SortableTable>
      <div className="flex justify-center items-center gap-3 py-2 text-xs">
        <button disabled={loading || page <= 1} onClick={() => setPage(p => p - 1)}>السابق</button>
        <span>صفحة {page} من {totalPages}</span>
        <button disabled={loading || page >= totalPages} onClick={() => setPage(p => p + 1)}>التالي</button>
      </div>
    </div>
  )
}
