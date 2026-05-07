'use client'
import { format, startOfWeek, startOfMonth } from 'date-fns'

export function PeriodSelector({
  dateFrom, dateTo, setDateFrom, setDateTo,
}: {
  dateFrom: string
  dateTo: string
  setDateFrom: (s: string) => void
  setDateTo: (s: string) => void
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {[
        { label: 'اليوم', from: format(new Date(), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') },
        { label: 'هذا الأسبوع', from: format(startOfWeek(new Date(), { weekStartsOn: 6 }), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') },
        { label: 'هذا الشهر', from: format(startOfMonth(new Date()), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') },
        { label: 'الكل', from: '', to: '' },
      ].map(p => (
        <button
          key={p.label}
          onClick={() => { setDateFrom(p.from); setDateTo(p.to) }}
          className={`btn-sm rounded-full text-xs font-medium px-3 py-1 transition-colors ${
            dateFrom === p.from && dateTo === p.to
              ? 'bg-brand-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {p.label}
        </button>
      ))}
      <div className="w-px h-6 bg-gray-200 mx-1" />
      <input type="date" className="input text-sm w-auto py-1.5" value={dateFrom}
        onChange={e => setDateFrom(e.target.value)} />
      <span className="text-gray-400 text-sm">—</span>
      <input type="date" className="input text-sm w-auto py-1.5" value={dateTo}
        onChange={e => setDateTo(e.target.value)} />
    </div>
  )
}
