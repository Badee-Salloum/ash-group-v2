'use client'
// Shared period chooser — week mode (PayrollTab-style: prev/chip/next/home)
// and range mode (presets + from/to inputs). Used by Overview + Bonuses tabs
// so all three views share the same navigation muscle memory.

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtSyriaDate } from '@/lib/datetime'

// Local-calendar Sunday-aligned YYYY-MM-DD. Anchor at noon to dodge the
// UTC ↔ Damascus +3 boundary that shifted "next" two days back.
export function startOfWeek(d: Date | string): string {
  let dt: Date
  if (typeof d === 'string') {
    dt = new Date(`${d}T12:00:00`)
  } else {
    dt = new Date(d.getTime())
    dt.setHours(12, 0, 0, 0)
  }
  const day = dt.getDay()
  dt.setDate(dt.getDate() - day)
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const da = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

export function addDaysISO(iso: string, days: number): string {
  const dt = new Date(`${iso}T12:00:00`)
  dt.setDate(dt.getDate() + days)
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const da = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

export function isoWeekNumber(d: Date): number {
  const target = new Date(d.valueOf())
  const dayNr = (d.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNr + 3)
  const firstThursday = target.valueOf()
  target.setMonth(0, 1)
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7)
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000)
}

export type PeriodMode = 'week' | 'range'

interface Props {
  mode: PeriodMode
  setMode: (m: PeriodMode) => void
  weekStart: string
  setWeekStart: (s: string) => void
  rangeFrom: string
  setRangeFrom: (s: string) => void
  rangeTo: string
  setRangeTo: (s: string) => void
}

// Resolve the effective (from, to) pair the parent should pass to the
// API based on the current mode. Single source of truth so Overview +
// Bonuses can't accidentally drift in how they bridge week → range.
export function effectiveRange(props: {
  mode: PeriodMode
  weekStart: string
  rangeFrom: string
  rangeTo: string
}): { from: string; to: string } {
  if (props.mode === 'week') {
    return { from: props.weekStart, to: addDaysISO(props.weekStart, 6) }
  }
  return { from: props.rangeFrom, to: props.rangeTo }
}

export function PeriodChooser({
  mode, setMode,
  weekStart, setWeekStart,
  rangeFrom, setRangeFrom,
  rangeTo, setRangeTo,
}: Props) {
  const todayWeek = startOfWeek(new Date())
  const isCurrentWeek = weekStart === todayWeek
  const isFutureWeek = weekStart > todayWeek

  function changeWeek(delta: number) {
    setWeekStart(addDaysISO(weekStart, delta * 7))
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Mode toggle — same chip as PayrollTab */}
      <div className="inline-flex rounded-xl bg-gray-100 p-0.5 text-xs">
        <button onClick={() => setMode('week')}
          className={`px-3 py-1.5 rounded-lg transition ${mode === 'week' ? 'bg-white shadow-sm font-bold' : 'text-gray-500'}`}>
          أسبوع
        </button>
        <button onClick={() => setMode('range')}
          className={`px-3 py-1.5 rounded-lg transition ${mode === 'range' ? 'bg-white shadow-sm font-bold' : 'text-gray-500'}`}>
          فترة مخصّصة
        </button>
      </div>

      {mode === 'week' ? (
        <>
          <button
            onClick={() => changeWeek(-1)}
            className="btn-secondary btn-sm inline-flex items-center gap-1"
            title="الأسبوع السابق"
          >
            <ChevronRight size={14} />
            <span className="hidden sm:inline">السابق</span>
          </button>
          {(() => {
            const we = addDaysISO(weekStart, 6)
            const wsDate = new Date(`${weekStart}T12:00:00`)
            return (
              <label className="inline-flex items-center gap-2 bg-blue-50 text-blue-800 hover:bg-blue-100 px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer relative">
                <span>الأسبوع <span className="font-mono font-bold">{isoWeekNumber(wsDate)}</span></span>
                <span className="text-blue-300">·</span>
                <span className="font-mono">{fmtSyriaDate(weekStart)}</span>
                <span className="text-blue-300">←</span>
                <span className="font-mono">{fmtSyriaDate(we)}</span>
                <input
                  type="date"
                  value={weekStart}
                  onChange={e => setWeekStart(startOfWeek(e.target.value))}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  title="اختر تاريخاً للقفز إلى أسبوعه"
                />
              </label>
            )
          })()}
          <button
            onClick={() => changeWeek(1)}
            disabled={isCurrentWeek || isFutureWeek}
            className="btn-secondary btn-sm inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
            title={isCurrentWeek ? 'لا يوجد أسبوع تالٍ' : 'الأسبوع التالي'}
          >
            <span className="hidden sm:inline">التالي</span>
            <ChevronLeft size={14} />
          </button>
          {!isCurrentWeek && (
            <button
              onClick={() => setWeekStart(todayWeek)}
              className="btn-ghost btn-sm text-blue-700 inline-flex items-center gap-1"
              title="العودة للأسبوع الحالي"
            >
              ⌂ الحالي
            </button>
          )}
        </>
      ) : (
        <>
          <input type="date" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} className="input py-1 text-sm w-auto" title="من" />
          <span className="text-gray-400 text-xs">←</span>
          <input type="date" value={rangeTo} onChange={e => setRangeTo(e.target.value)} className="input py-1 text-sm w-auto" title="إلى" />
          <div className="inline-flex rounded-xl bg-gray-50 p-0.5 text-[11px]">
            {[
              { label: '٧ أيام', days: 7 },
              { label: '٣٠ يوماً', days: 30 },
              { label: '٩٠ يوماً', days: 90 },
            ].map(p => (
              <button key={p.days} onClick={() => {
                const d = new Date(); d.setHours(0, 0, 0, 0)
                const f = new Date(d); f.setDate(d.getDate() - p.days + 1)
                setRangeFrom(f.toISOString().slice(0, 10))
                setRangeTo(d.toISOString().slice(0, 10))
              }} className="px-2 py-1 rounded-lg text-gray-600 hover:bg-white">{p.label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
