'use client'
import { Search, X, AlertTriangle } from 'lucide-react'
import { Filters, STATUS_LABELS, REVIEW_LABELS } from './types'

export function FilterBar({
  filters,
  setFilters,
  accounts,
  availableCurrencies,
  hideMatched,
  onToggleHideMatched,
  search,
  setSearch,
  duplicatesOnly,
  setDuplicatesOnly,
  duplicateScCount,
}: {
  filters: Filters
  setFilters: React.Dispatch<React.SetStateAction<Filters>>
  accounts: Array<{ id: string; name: string }>
  availableCurrencies: string[]
  hideMatched: boolean
  onToggleHideMatched: () => void
  search: string
  setSearch: (v: string) => void
  duplicatesOnly: boolean
  setDuplicatesOnly: (v: boolean) => void
  duplicateScCount: number
}) {
  function setFilter(key: keyof Filters, val: string) {
    setFilters(f => ({ ...f, [key]: val }))
  }

  return (
    <div className="card p-3 sm:p-4 space-y-3">
      {/* Server-side search — hits /api/transactions ?search=, covers all
          pages, finds matched-pair counterparts even when the dedup
          filter would otherwise hide one side. */}
      <div className="relative">
        <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="search"
          className="input text-sm pr-10 pl-9 w-full"
          placeholder="بحث برقم الشام كاش / المنصة / معرّف المستخدم"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50"
            title="مسح البحث"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Quick filter chips — duplicate-SC toggle lives here alongside
          the other view-toggling chips so the row reads as a coherent
          "ways to slice the data" cluster. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">وصول سريع:</span>
        <button
          onClick={() => setFilters(f => ({ ...f, reviewed: 'false', reviewCategory: '' }))}
          className={`text-xs px-3 py-1.5 rounded-lg ring-1 transition-colors font-medium ${
            filters.reviewed === 'false'
              ? 'bg-amber-100 text-amber-800 ring-amber-300'
              : 'bg-white text-gray-600 ring-gray-200 hover:bg-amber-50 hover:text-amber-700 hover:ring-amber-200'
          }`}
        >
          العمليات غير المراجعة
        </button>
        <button
          onClick={() => setFilters(f => ({ ...f, reviewed: 'true', reviewCategory: '' }))}
          className={`text-xs px-3 py-1.5 rounded-lg ring-1 transition-colors font-medium ${
            filters.reviewed === 'true'
              ? 'bg-emerald-100 text-emerald-800 ring-emerald-300'
              : 'bg-white text-gray-600 ring-gray-200 hover:bg-emerald-50 hover:text-emerald-700 hover:ring-emerald-200'
          }`}
        >
          العمليات المُراجَعة
        </button>
        <button
          onClick={onToggleHideMatched}
          title={hideMatched
            ? 'المطابقات الكاملة مخفية الآن — اضغط لإظهارها'
            : 'المطابقات الكاملة معروضة الآن — اضغط لإخفائها'}
          className={`text-xs px-3 py-1.5 rounded-lg ring-1 transition-colors font-medium ${
            hideMatched
              ? 'bg-slate-100 text-slate-700 ring-slate-300'
              : 'bg-white text-gray-600 ring-gray-200 hover:bg-slate-50 hover:text-slate-700 hover:ring-slate-200'
          }`}
        >
          {hideMatched ? 'إظهار المطابقات' : 'إخفاء المطابقات'}
        </button>
        <button
          onClick={() => setDuplicatesOnly(!duplicatesOnly)}
          title="إظهار مجموعات أرقام شام كاش المعلّمة كتكرار فقط"
          className={`text-xs px-3 py-1.5 rounded-lg ring-1 transition-colors font-medium inline-flex items-center gap-1.5 ${
            duplicatesOnly
              ? 'bg-red-100 text-red-800 ring-red-300'
              : duplicateScCount > 0
                ? 'bg-white text-red-700 ring-red-200 hover:bg-red-50 hover:ring-red-300'
                : 'bg-white text-gray-500 ring-gray-200 hover:bg-gray-50'
          }`}
        >
          <AlertTriangle size={11} />
          {duplicatesOnly ? 'إلغاء فلتر التكرارات' : 'التكرارات'}
          {duplicateScCount > 0 && (
            <span className={`text-[10px] rounded-md px-1.5 py-0.5 font-mono font-bold ${
              duplicatesOnly ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 ring-1 ring-red-200'
            }`}>
              {duplicateScCount.toLocaleString('en')}
            </span>
          )}
        </button>
        {(filters.reviewed || filters.reviewCategory || filters.status || filters.type || filters.accountId || filters.currency || filters.dateFrom || filters.dateTo || search || duplicatesOnly) && (
          <button
            onClick={() => {
              setFilters({
                status: '', type: '', accountId: '', currency: '', dateFrom: '', dateTo: '',
                reviewed: '', reviewCategory: '',
              })
              setSearch('')
              setDuplicatesOnly(false)
            }}
            className="text-xs px-3 py-1.5 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors font-medium"
          >
            × مسح الكل
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3">
        <select className="input text-sm" value={filters.status} onChange={e => setFilter('status', e.target.value)}>
          <option value="">كل الحالات</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input text-sm" value={filters.type} onChange={e => setFilter('type', e.target.value)}>
          <option value="">إيداع وسحب</option>
          <option value="DEPOSIT">إيداع فقط</option>
          <option value="WITHDRAWAL">سحب فقط</option>
        </select>
        <select className="input text-sm" value={filters.accountId} onChange={e => setFilter('accountId', e.target.value)}>
          <option value="">كل الحسابات</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="input text-sm" value={filters.currency} onChange={e => setFilter('currency', e.target.value)}>
          <option value="">كل العملات</option>
          {availableCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input text-sm" value={filters.reviewed} onChange={e => setFilter('reviewed', e.target.value)}>
          <option value="">حالة المراجعة: الكل</option>
          <option value="false">لم تتم المراجعة</option>
          <option value="true">تمت المراجعة</option>
        </select>
        <select className="input text-sm" value={filters.reviewCategory} onChange={e => setFilter('reviewCategory', e.target.value)}>
          <option value="">نتيجة المراجعة: الكل</option>
          {Object.entries(REVIEW_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input type="date" className="input text-sm" value={filters.dateFrom}
          onChange={e => setFilter('dateFrom', e.target.value)} placeholder="من تاريخ" />
        <input type="date" className="input text-sm" value={filters.dateTo}
          onChange={e => setFilter('dateTo', e.target.value)} placeholder="إلى تاريخ" />
      </div>
    </div>
  )
}
