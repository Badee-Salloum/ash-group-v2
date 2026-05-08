'use client'
import { useEffect, useState, useCallback } from 'react'
import { Search, Inbox, Loader2, CheckCircle2, MessageSquareWarning, RotateCcw } from 'lucide-react'
import { fmtSyriaDate } from '@/lib/datetime'
import { FollowUpModal } from './_components/FollowUpModal'
import {
  FollowUpRow, AssigneeUser, FollowUpFilters, FollowUpStatus, FollowUpCategory,
  STATUS_LABELS, CATEGORY_LABELS, TYPE_LABELS,
} from './_components/types'

const DEFAULT_FILTERS: FollowUpFilters = {
  status: '',
  category: '',
  assignedTo: '',
  search: '',
  dateFrom: '',
  dateTo: '',
  includeClosed: false,
}

const STALE_DAYS = 7
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000

function isStale(row: FollowUpRow): boolean {
  if (row.followUpStatus !== 'OPEN') return false
  if (!row.reviewedAt) return false
  return Date.now() - new Date(row.reviewedAt).getTime() > STALE_MS
}

export default function FollowUpsPage() {
  const [rows, setRows] = useState<FollowUpRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({ OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 })
  const [assignees, setAssignees] = useState<AssigneeUser[]>([])
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [filters, setFilters] = useState<FollowUpFilters>(DEFAULT_FILTERS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [editing, setEditing] = useState<FollowUpRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (filters.status) params.set('status', filters.status)
      if (filters.category) params.set('category', filters.category)
      if (filters.assignedTo) params.set('assignedTo', filters.assignedTo)
      if (filters.search) params.set('search', filters.search)
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
      if (filters.dateTo) params.set('dateTo', filters.dateTo)
      if (filters.includeClosed) params.set('includeClosed', 'true')
      params.set('pageSize', '200')

      const r = await fetch(`/api/follow-ups?${params.toString()}`)
      const d = await r.json()
      if (!d.success) {
        setError(d.error || 'تعذّر تحميل المتابعات')
        return
      }
      setRows(d.data || [])
      setCounts(d.counts || {})
      setAssignees(d.assignees || [])
      setCurrentUserId(d.currentUserId || '')
    } catch {
      setError('تعذّر الاتصال بالخادم')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { load() }, [load])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-fade-in">
          <CheckCircle2 size={18} /> {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <MessageSquareWarning size={22} className="text-amber-500" />
            متابعات الزبائن والمنصات
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            عمليات تحتاج إجراء: شكاوى الزبائن، أخطاء العملاء، أخطاء المنصة
          </p>
        </div>
      </div>

      {/* Status pills */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {(Object.keys(STATUS_LABELS) as FollowUpStatus[]).map(s => {
          const meta = STATUS_LABELS[s]
          const active = filters.status === s
          return (
            <button
              key={s}
              onClick={() => setFilters(f => ({
                ...f,
                status: active ? '' : s,
                includeClosed: s === 'RESOLVED' || s === 'CLOSED' ? true : f.includeClosed,
              }))}
              className={`p-4 rounded-xl ring-1 text-right transition-all ${
                active
                  ? `${meta.cls} ring-current/20`
                  : 'bg-white ring-slate-200 hover:ring-slate-300'
              }`}
            >
              <div className="text-xs font-semibold text-slate-500 mb-1">{meta.label}</div>
              <div className="text-2xl font-bold text-slate-800">{counts[s] ?? 0}</div>
            </button>
          )
        })}
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative md:col-span-2">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              placeholder="بحث (User ID، رقم العملية، ملاحظة، حل…)"
              className="w-full pr-9 pl-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>

          {/* Category */}
          <select
            value={filters.category}
            onChange={e => setFilters(f => ({ ...f, category: e.target.value as FollowUpCategory | '' }))}
            className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          >
            <option value="">كل الفئات</option>
            {(Object.keys(CATEGORY_LABELS) as FollowUpCategory[]).map(c => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>

          {/* Assignee */}
          <select
            value={filters.assignedTo}
            onChange={e => setFilters(f => ({ ...f, assignedTo: e.target.value }))}
            className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          >
            <option value="">كل المسؤولين</option>
            <option value="me">المسنَدة لي</option>
            <option value="unassigned">غير مُسنَدة</option>
            {assignees.length > 0 && <option disabled>──────</option>}
            {assignees.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>

          {/* Date range */}
          <div className="flex gap-2">
            <input
              type="date"
              value={filters.dateFrom}
              onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
              className="flex-1 min-w-0 px-2 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              title="من تاريخ"
            />
            <input
              type="date"
              value={filters.dateTo}
              onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
              className="flex-1 min-w-0 px-2 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              title="إلى تاريخ"
            />
          </div>

          {/* Include closed + reset */}
          <div className="flex items-center justify-between md:col-span-2 lg:col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.includeClosed}
                onChange={e => setFilters(f => ({ ...f, includeClosed: e.target.checked }))}
                className="rounded border-slate-300"
              />
              تضمين المنتهية (تم الحل/مغلقة)
            </label>
            <button
              onClick={resetFilters}
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 px-2 py-1"
            >
              <RotateCcw size={12} /> إعادة تعيين
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-xl mb-4">
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="animate-spin" size={24} />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 py-16 text-center">
          <Inbox size={48} className="mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500">لا توجد متابعات مطابقة للفلاتر الحالية</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3">الحالة</th>
                  <th className="px-4 py-3">الفئة</th>
                  <th className="px-4 py-3">الحساب</th>
                  <th className="px-4 py-3">المبلغ</th>
                  <th className="px-4 py-3">User ID</th>
                  <th className="px-4 py-3">المُسنَد</th>
                  <th className="px-4 py-3">تاريخ المراجعة</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(r => {
                  const statusMeta = r.followUpStatus ? STATUS_LABELS[r.followUpStatus] : null
                  const stale = isStale(r)
                  return (
                    <tr key={r.id} className={`hover:bg-slate-50/60 transition-colors ${stale ? 'bg-rose-50/30' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 items-start">
                          {statusMeta && (
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ${statusMeta.cls}`}>
                              {statusMeta.label}
                            </span>
                          )}
                          {stale && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 ring-1 ring-rose-200">
                              ● متأخّرة
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {r.reviewCategory && CATEGORY_LABELS[r.reviewCategory]}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="font-medium">{r.accountName}</div>
                        <div className="text-xs text-slate-400">{TYPE_LABELS[r.type]}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-800">
                        {Number(r.amount).toLocaleString()}{' '}
                        <span className="text-xs text-slate-400">{r.currency}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500" dir="ltr">
                        {r.platformUserId || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {r.followUpAssigneeName ? (
                          <span>{r.followUpAssigneeName}</span>
                        ) : (
                          <span className="text-amber-600 text-xs font-semibold">غير مُسنَد</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 font-mono">
                        {r.reviewedAt ? fmtSyriaDate(r.reviewedAt) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setEditing(r)}
                          className="px-3 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-semibold"
                        >
                          إدارة
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <FollowUpModal
          row={editing}
          assignees={assignees}
          currentUserId={currentUserId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            showToast('تم حفظ التحديث')
            load()
          }}
        />
      )}
    </div>
  )
}
