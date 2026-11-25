'use client'
// Phase F — coverage breakdown below the shifts grid. Reads CoverageAssignment
// rows from the parent and renders 7 day-cards showing who covers each half
// of an on-leave teammate's shift.

import { CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react'

const DAY_LABELS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

// Pairs of half-shift rows that share the same on-leave user and date, plus
// the resolved names. Caller pre-aggregates server rows into this shape so
// this component stays presentational.
export interface CoveragePair {
  date: string
  onLeaveUserId: string
  onLeaveName: string
  walletIds: string[]
  firstHalf: { coverUserId: string; coverName: string; start: string; end: string }
  secondHalf: { coverUserId: string; coverName: string; start: string; end: string }
}

interface Props {
  weekDates: string[]
  pairsByDate: Map<string, CoveragePair[]>
  // Account id → display name for the wallet badges. Falls back to a
  // 6-char id slice when an id isn't found.
  accountNames?: Map<string, string>
  // Optional — when a day has fewer than 2 group members working any half.
  redDates?: Set<string>
}

export function CoverageSummary({ weekDates, pairsByDate, accountNames, redDates }: Props) {
  const nameFor = (id: string) => accountNames?.get(id) ?? id.slice(0, 6)
  return (
    <div className="card p-4 space-y-3">
      <div>
        <h2 className="text-base font-bold text-gray-900">كيف ستتم التغطية</h2>
        <p className="text-[11px] text-gray-500 mt-0.5">
          عند إجازة أحد أعضاء مجموعة محافظ، تُقسم الـ ٨ ساعات إلى نصفَين، كل نصف يغطّيه عضو آخر من مجموعته.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {weekDates.map((d, i) => {
          const pairs = pairsByDate.get(d) ?? []
          const isRed = redDates?.has(d)
          const tone = pairs.length === 0
            ? 'border-emerald-200 bg-emerald-50/40'
            : isRed
              ? 'border-rose-300 bg-rose-50/40'
              : 'border-amber-200 bg-amber-50/40'
          const Icon = pairs.length === 0 ? CheckCircle2 : isRed ? AlertTriangle : AlertCircle
          const iconCls = pairs.length === 0 ? 'text-emerald-600' : isRed ? 'text-rose-600' : 'text-amber-600'
          return (
            <div key={d} className={`rounded-xl border ${tone} p-3 space-y-2`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Icon size={14} className={iconCls} />
                  <span className="text-xs font-semibold text-gray-800">
                    {DAY_LABELS_AR[i]} <span className="font-mono text-gray-500">{d.slice(5)}</span>
                  </span>
                </div>
                <span className="text-[10px] text-gray-500 font-mono">
                  {pairs.length === 0 ? 'كامل التغطية' : `${pairs.length} إجازة`}
                </span>
              </div>

              {pairs.length === 0 ? (
                <p className="text-[11px] text-gray-400">لا توجد إجازات هذا اليوم.</p>
              ) : (
                <ul className="space-y-2">
                  {pairs.map((p, idx) => (
                    <li key={`${p.onLeaveUserId}-${idx}`} className="text-xs space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-gray-800">{p.onLeaveName}</span>
                        <span className="text-gray-400">·</span>
                        <span className="text-[10px] text-gray-500">بإجازة</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {p.walletIds.map(w => (
                          <span key={w} className="text-[9px] bg-white text-gray-700 px-1.5 py-0.5 rounded ring-1 ring-gray-200">
                            {nameFor(w)}
                          </span>
                        ))}
                      </div>
                      <div className="pr-2 space-y-0.5">
                        <p className="text-[11px]">
                          <span className="font-mono text-gray-700">{p.firstHalf.start}→{p.firstHalf.end}</span>
                          {' · '}
                          <span className="font-medium text-emerald-700">{p.firstHalf.coverName}</span>
                          <span className="text-[10px] text-gray-400"> (+4h)</span>
                        </p>
                        <p className="text-[11px]">
                          <span className="font-mono text-gray-700">{p.secondHalf.start}→{p.secondHalf.end}</span>
                          {' · '}
                          <span className="font-medium text-emerald-700">{p.secondHalf.coverName}</span>
                          <span className="text-[10px] text-gray-400"> (+4h)</span>
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
