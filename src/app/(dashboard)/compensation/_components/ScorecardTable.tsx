'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronUp, ChevronDown, X, CheckCircle2, RotateCcw, Loader2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/ConfirmDialog'

export interface ScorecardRow {
  id: string
  name: string
  employeeCode: string | null
  jobTitle: string | null
  role: string
  avatarUrl: string | null
  baseSalary: number | null
  operationsHandled: number
  matchedCount: number
  discrepancyCount: number
  totalAmount: number
  errorCount: number
  theftCount: number
  wasteCount: number
  complaintCount: number
  matchRate: number
  cumulativeStreak: number
  cumulativeAmount: number
  bonusGroup: number
  bonusManual: number
  latestPayrollId: string | null
  latestPayrollNet: number
  latestPayrollStatus: string | null
  latestPayrollWeekStart: string | null
}

export type SortKey = 'name' | 'operations' | 'matchRate' | 'errors' | 'thefts' | 'complaints' | 'cumulative' | 'net'

interface Props {
  rows: ScorecardRow[]
  loading: boolean
  search: string
  setSearch: (s: string) => void
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  setSort: (k: SortKey) => void
  // Phase: called when admin clicks دفع / تراجع on a row. The row is
  // passed in whole so the parent can handle cases where there's no
  // saved PayrollEntry yet (it generates one first, then pays).
  onPayChange?: (row: ScorecardRow, status: 'PAID' | 'DRAFT') => Promise<void>
}

export function ScorecardTable({ rows, loading, search, setSearch, sortKey, sortDir, setSort, onPayChange }: Props) {
  const confirm = useConfirm()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function handlePayChange(row: ScorecardRow, target: 'PAID' | 'DRAFT') {
    if (!onPayChange) return
    const ok = await confirm(
      target === 'PAID'
        ? `تأكيد دفع راتب ${row.name}؟`
        : `تأكيد التراجع عن دفع راتب ${row.name}؟ سيُحذف من /expenses.`,
    )
    if (!ok) return
    setBusyId(row.id)
    try {
      await onPayChange(row, target)
    } finally {
      setBusyId(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.employeeCode || '').toLowerCase().includes(q) ||
      (r.jobTitle || '').toLowerCase().includes(q)
    )
  }, [rows, search])

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      let av: number | string, bv: number | string
      switch (sortKey) {
        case 'name': av = a.name; bv = b.name; break
        case 'operations': av = a.operationsHandled; bv = b.operationsHandled; break
        case 'matchRate': av = a.matchRate; bv = b.matchRate; break
        case 'errors': av = a.errorCount + a.theftCount; bv = b.errorCount + b.theftCount; break
        case 'thefts': av = a.theftCount; bv = b.theftCount; break
        case 'complaints': av = a.complaintCount; bv = b.complaintCount; break
        case 'cumulative': av = a.cumulativeAmount; bv = b.cumulativeAmount; break
        case 'net': av = a.latestPayrollNet; bv = b.latestPayrollNet; break
      }
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  }, [filtered, sortKey, sortDir])

  return (
    <div className="card overflow-hidden">
      <div className="px-3 py-2.5 border-b border-gray-100 flex items-center gap-3 flex-wrap">
        <h3 className="font-bold text-sm text-gray-800">📋 الموظفون</h3>
        <span className="text-xs text-gray-500">
          {filtered.length.toLocaleString('ar')} {filtered.length !== rows.length && <>من {rows.length}</>} موظف
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <Th label="الموظف" k="name" sortKey={sortKey} sortDir={sortDir} setSort={setSort} align="right" />
              <Th label="العمليات" k="operations" sortKey={sortKey} sortDir={sortDir} setSort={setSort} />
              <Th label="نسبة المطابقة" k="matchRate" sortKey={sortKey} sortDir={sortDir} setSort={setSort} />
              <Th label="الأخطاء" k="errors" sortKey={sortKey} sortDir={sortDir} setSort={setSort} />
              <Th label="السرقات" k="thefts" sortKey={sortKey} sortDir={sortDir} setSort={setSort} />
              <Th label="الشكاوى" k="complaints" sortKey={sortKey} sortDir={sortDir} setSort={setSort} />
              <Th label="المكافأة التراكمية" k="cumulative" sortKey={sortKey} sortDir={sortDir} setSort={setSort} />
              <Th label="آخر راتب" k="net" sortKey={sortKey} sortDir={sortDir} setSort={setSort} />
              {onPayChange && <th className="text-center px-3 py-3">إجراء</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <SkeletonRows />
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={onPayChange ? 9 : 8} className="text-center text-gray-400 py-10">
                  {search ? (
                    <div className="flex flex-col items-center gap-2">
                      <span>لا يوجد موظف يطابق <span className="font-mono text-gray-600">&quot;{search}&quot;</span></span>
                      <button onClick={() => setSearch('')} className="btn-secondary btn-sm">
                        <X size={13} /> مسح البحث
                      </button>
                    </div>
                  ) : 'لا يوجد موظفون'}
                </td>
              </tr>
            ) : sorted.map(r => (
              <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                <td className="px-3 py-2">
                  <Link href={`/compensation/${r.id}`} className="flex items-center gap-2 hover:text-brand-600">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {r.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-semibold">{r.name}</div>
                      <div className="text-[10px] text-gray-400">{r.employeeCode || '—'} · {r.jobTitle || '—'}</div>
                    </div>
                  </Link>
                </td>
                <td className="px-3 py-2 text-center font-mono text-sm">{r.operationsHandled.toLocaleString('ar')}</td>
                <td className="px-3 py-2 text-center"><MatchRatePill rate={r.matchRate} /></td>
                <td className="px-3 py-2 text-center"><CountBadge count={r.errorCount} tone="amber" /></td>
                <td className="px-3 py-2 text-center"><CountBadge count={r.theftCount} tone="rose" /></td>
                <td className="px-3 py-2 text-center"><CountBadge count={r.complaintCount} tone="violet" /></td>
                <td className="px-3 py-2 text-center">
                  <div className="font-mono text-sm">{r.cumulativeAmount.toLocaleString('en')}</div>
                  <div className="text-[10px] text-gray-400">{r.cumulativeStreak} أسبوع</div>
                </td>
                <td className="px-3 py-2 text-center">
                  {r.latestPayrollStatus ? (
                    <>
                      <div className="font-mono text-sm">{r.latestPayrollNet.toLocaleString('en')}</div>
                      <div className="text-[10px] text-gray-400">{r.latestPayrollStatus}</div>
                    </>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                {onPayChange && (
                  <td className="px-3 py-2 text-center">
                    {busyId === r.id ? (
                      <Loader2 size={14} className="animate-spin mx-auto text-gray-400" />
                    ) : r.latestPayrollStatus === 'PAID' ? (
                      <button
                        onClick={() => handlePayChange(r, 'DRAFT')}
                        className="inline-flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-900 hover:bg-amber-50 px-2 py-1 rounded transition-colors"
                        title="إلغاء حالة الدفع وحذف الصرفية المرتبطة"
                      >
                        <RotateCcw size={11} /> تراجع
                      </button>
                    ) : (
                      <button
                        onClick={() => handlePayChange(r, 'PAID')}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-white hover:bg-emerald-600 px-2 py-1 rounded ring-1 ring-emerald-200 transition-colors"
                        title="تعليم الراتب كمدفوع — يُنشئ صرفية في /expenses (مع توليد سجل الراتب لو لم يكن موجوداً)"
                      >
                        <CheckCircle2 size={11} /> دفع
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ label, k, sortKey, sortDir, setSort, align = 'center' }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: 'asc' | 'desc'
  setSort: (k: SortKey) => void; align?: 'right' | 'center'
}) {
  const active = sortKey === k
  return (
    <th
      aria-sort={active ? sortDir === 'asc' ? 'ascending' : 'descending' : 'none'}
      className={`text-${align} px-3 py-3 cursor-pointer hover:text-slate-800 transition-colors select-none ${active ? 'text-slate-800' : ''}`}
    >
      <button type="button" onClick={() => setSort(k)} className={`inline-flex items-center gap-0.5 ${align === 'right' ? '' : 'justify-center'}`}>
        {label}
        {active && (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
      </button>
    </th>
  )
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3, 4].map(i => (
        <tr key={i} className="animate-pulse">
          <td className="px-3 py-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-slate-200" />
              <div className="flex-1">
                <div className="h-3 w-24 bg-slate-200 rounded mb-1" />
                <div className="h-2 w-16 bg-slate-100 rounded" />
              </div>
            </div>
          </td>
          {[1,2,3,4,5,6,7].map(j => (
            <td key={j} className="px-3 py-3"><div className="h-3 w-12 bg-slate-200 rounded mx-auto" /></td>
          ))}
        </tr>
      ))}
    </>
  )
}

function MatchRatePill({ rate }: { rate: number }) {
  const tone = rate >= 90 ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
    : rate >= 70 ? 'bg-amber-100 text-amber-700 ring-amber-200'
    : rate > 0 ? 'bg-rose-100 text-rose-700 ring-rose-200'
    : 'bg-gray-100 text-gray-500 ring-gray-200'
  return <span className={`inline-flex items-center justify-center text-[11px] font-bold font-mono px-2 py-0.5 rounded-full ring-1 ${tone}`}>{rate}%</span>
}

function CountBadge({ count, tone }: { count: number; tone: 'amber' | 'rose' | 'violet' }) {
  if (count === 0) return <span className="text-gray-300 font-mono">—</span>
  const cls = {
    amber: 'bg-amber-100 text-amber-800 ring-amber-200',
    rose: 'bg-rose-100 text-rose-800 ring-rose-200',
    violet: 'bg-violet-100 text-violet-800 ring-violet-200',
  }[tone]
  return <span className={`inline-flex items-center justify-center text-[11px] font-bold font-mono px-2 py-0.5 rounded-full ring-1 ${cls}`}>{count}</span>
}
