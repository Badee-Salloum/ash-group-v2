'use client'
import { useEffect, useState, useCallback } from 'react'
import { ChevronRight, ChevronLeft, Loader2, Clock, RefreshCw } from 'lucide-react'
import { fmtSyriaDate, fmtSyria } from '@/lib/datetime'

interface DayCell {
  dayIndex: number
  date: string
  sessionsCount: number
  totalMinutes: number
  isActive: boolean
  isComplete: boolean
  // Planned roster for this day from the schedule (null = nothing scheduled).
  plannedShift: 'ONE' | 'TWO' | 'THREE' | null
  plannedDayOff: boolean
  sessions: Array<{
    id: string
    startAt: string
    endAt: string | null
    status: string
    shiftNumber: string | null
    durationMinutes: number | null
  }>
}

interface AttendanceRow {
  id: string
  name: string
  jobTitle: string | null
  employeeCode: string | null
  avatarUrl: string | null
  role: string
  weekMinutes: number
  days: DayCell[]
}

const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

function startOfWeek(d: Date): string {
  const day = d.getDay()
  const m = new Date(d); m.setDate(d.getDate() - day); m.setHours(0, 0, 0, 0)
  return m.toISOString().slice(0, 10)
}
function isoWeekNumber(d: Date): number {
  const target = new Date(d.valueOf())
  const dayNr = (d.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNr + 3)
  const firstThursday = target.valueOf()
  target.setMonth(0, 1)
  if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7)
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000)
}
function fmtHours(mins: number): string {
  if (mins === 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}س` : `${h}س ${m}د`
}

export default function AttendancePage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCell, setActiveCell] = useState<{ row: string; day: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/attendance?weekStart=${weekStart}`)
    const d = await r.json()
    if (d.success) setRows(d.employees)
    setLoading(false)
  }, [weekStart])

  useEffect(() => { load() }, [load])

  function changeWeek(delta: number) {
    const d = new Date(weekStart); d.setDate(d.getDate() + delta * 7)
    setWeekStart(startOfWeek(d))
  }

  const ws = new Date(weekStart)
  const we = new Date(ws); we.setDate(ws.getDate() + 6)

  const totalMinutesAll = rows.reduce((s, r) => s + r.weekMinutes, 0)
  const activeNow = rows.reduce(
    (s, r) => s + r.days.reduce((a, d) => a + (d.isActive ? 1 : 0), 0), 0,
  )

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">أوقات الدوام</h1>
          <p className="text-sm text-gray-500 mt-0.5">تتبّع حضور وانصراف الموظفين</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-2 bg-blue-50 text-blue-800 px-3 py-1.5 rounded-xl text-xs font-medium">
            <span>الأسبوع <span className="font-mono font-bold">{isoWeekNumber(ws)}</span></span>
            <span className="text-blue-300">·</span>
            <span className="font-mono">{fmtSyriaDate(weekStart)}</span>
            <span className="text-blue-300">←</span>
            <span className="font-mono">{fmtSyriaDate(we)}</span>
          </span>
          <button onClick={() => changeWeek(-1)} className="btn-secondary btn-sm" title="الأسبوع السابق">
            <ChevronRight size={14} />
          </button>
          <input type="date" value={weekStart} onChange={e => setWeekStart(e.target.value)} className="input py-1 text-sm w-auto" />
          <button onClick={() => changeWeek(1)} className="btn-secondary btn-sm" title="الأسبوع التالي">
            <ChevronLeft size={14} />
          </button>
          <button onClick={load} className="btn-secondary btn-sm" title="تحديث">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-[10px] text-gray-400 font-bold uppercase">إجمالي الموظفين</p>
          <p className="text-xl font-bold font-mono">{rows.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] text-emerald-500 font-bold uppercase">يداومون الآن</p>
          <p className="text-xl font-bold text-emerald-700 font-mono">{activeNow}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] text-blue-500 font-bold uppercase">إجمالي ساعات الأسبوع</p>
          <p className="text-xl font-bold text-blue-700 font-mono">{fmtHours(totalMinutesAll)}</p>
        </div>
      </div>

      {loading ? (
        <div className="card p-12 text-center text-gray-400">
          <Loader2 size={28} className="mx-auto animate-spin mb-2" /> جاري التحميل...
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <Clock size={28} className="mx-auto mb-2 opacity-30" />
          لا يوجد موظفون
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="bg-gray-50 sticky top-0 z-10">
                <th className="px-3 py-2 text-right font-semibold text-gray-600 sticky right-0 bg-gray-50 min-w-[180px]">
                  الموظف
                </th>
                {DAY_NAMES.map((dn, i) => {
                  const date = new Date(ws); date.setDate(ws.getDate() + i)
                  const isToday = new Date().toDateString() === date.toDateString()
                  return (
                    <th key={i} className={`px-3 py-2 text-center font-semibold text-gray-600 min-w-[110px] ${isToday ? 'bg-blue-50' : ''}`}>
                      <div className="text-xs">{dn}</div>
                      <div className="text-[10px] text-gray-400 font-mono">{date.getDate()}/{date.getMonth() + 1}</div>
                    </th>
                  )
                })}
                <th className="px-3 py-2 text-center font-semibold text-gray-600 min-w-[90px]">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 sticky right-0 bg-white border-r border-gray-100">
                    <div className="flex items-center gap-2">
                      {row.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.avatarUrl} alt={row.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                          {row.name.charAt(0)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate text-xs">{row.name}</p>
                        <p className="text-[10px] text-gray-400 truncate">{row.jobTitle || '—'}</p>
                      </div>
                    </div>
                  </td>
                  {row.days.map(d => {
                    const cellKey = `${row.id}-${d.dayIndex}`
                    const isActiveCell = activeCell?.row === row.id && activeCell?.day === d.dayIndex

                    // Group sessions by shift number to render 3 sub-cells.
                    // Sessions without a shiftNumber fall back to the closest
                    // shift based on startAt's hour.
                    function shiftOf(s: { shiftNumber: string | null; startAt: string }): 'ONE' | 'TWO' | 'THREE' {
                      if (s.shiftNumber === 'ONE' || s.shiftNumber === 'TWO' || s.shiftNumber === 'THREE') return s.shiftNumber
                      const h = new Date(s.startAt).getHours()
                      if (h >= 6 && h < 14) return 'ONE'
                      if (h >= 14 && h < 22) return 'TWO'
                      return 'THREE'
                    }
                    const shifts: Record<'ONE' | 'TWO' | 'THREE', typeof d.sessions> = {
                      ONE: [], TWO: [], THREE: [],
                    }
                    for (const s of d.sessions) shifts[shiftOf(s)].push(s)

                    const SHIFT_META = [
                      { key: 'ONE'   as const, label: 'صباحي', range: '٦-٢',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
                      { key: 'TWO'   as const, label: 'مسائي', range: '٢-١٠', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
                      { key: 'THREE' as const, label: 'ليلي',  range: '١٠-٦', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                    ]
                    const minutesOf = (sessions: typeof d.sessions) =>
                      sessions.reduce((sum: number, x: typeof sessions[0]) => {
                        if (x.durationMinutes) return sum + x.durationMinutes
                        if (x.endAt) return sum + Math.round((new Date(x.endAt).getTime() - new Date(x.startAt).getTime()) / 60000)
                        if (x.status === 'ACTIVE' || x.status === 'PENDING_END') {
                          return sum + Math.round((Date.now() - new Date(x.startAt).getTime()) / 60000)
                        }
                        return sum
                      }, 0)

                    return (
                      <td key={cellKey} className="px-1 py-1 text-center align-top relative">
                        <div className="flex flex-col gap-0.5">
                          {SHIFT_META.map(sm => {
                            const list = shifts[sm.key]
                            const has = list.length > 0
                            const isActive = list.some((s: typeof list[0]) => s.status === 'ACTIVE' || s.status === 'PENDING_END')
                            const mins = minutesOf(list)
                            // Is this sub-cell the shift the employee is *scheduled*
                            // for on this day? Used to hint the planned roster
                            // behind actual attendance.
                            const isPlanned = d.plannedShift === sm.key
                            const isPlannedOff = d.plannedDayOff
                            const cls = !has
                              ? isPlanned
                                ? 'bg-blue-50/60 text-blue-400 border-blue-200 border-dashed'
                                : isPlannedOff
                                  ? 'bg-gray-50 text-gray-300 border-gray-100'
                                  : 'bg-gray-50 text-gray-300 border-gray-100'
                              : isActive
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : sm.cls
                            // Cell value: actual hours if checked in, else a planned
                            // hint ("مجدول" / "إجازة"), else plain "—".
                            const value = has
                              ? fmtHours(mins)
                              : isPlanned
                                ? 'مجدول'
                                : isPlannedOff
                                  ? 'إجازة'
                                  : '—'
                            const titleSuffix = has
                              ? ' — ' + fmtHours(mins)
                              : isPlanned
                                ? ' — مجدول (لم يسجّل دخول بعد)'
                                : isPlannedOff
                                  ? ' — إجازة مجدولة'
                                  : ' — لم يداوم'
                            return (
                              <button
                                key={sm.key}
                                onClick={() => has && setActiveCell(isActiveCell ? null : { row: row.id, day: d.dayIndex })}
                                disabled={!has}
                                className={`w-full rounded border px-1.5 py-0.5 text-[10px] transition hover:shadow-sm flex items-center justify-between ${cls}`}
                                title={`${sm.label} (${sm.range})${titleSuffix}`}
                              >
                                <span className="opacity-70">{sm.label}</span>
                                <span className={`font-mono ${value === 'مجدول' || value === 'إجازة' ? 'text-[9px]' : 'font-bold'}`}>{value}</span>
                                {isActive && <span className="text-[8px]">●</span>}
                              </button>
                            )
                          })}
                        </div>
                        {isActiveCell && d.sessions.length > 0 && (
                          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-3 min-w-[240px] text-right">
                            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">جلسات اليوم</p>
                            {d.sessions.map(s => (
                              <div key={s.id} className="text-xs py-1 border-b border-gray-50 last:border-0">
                                <div className="font-mono text-gray-700">
                                  {fmtSyria(s.startAt, false)} → {s.endAt ? fmtSyria(s.endAt, false) : 'الآن'}
                                </div>
                                <div className="text-[10px] text-gray-400">
                                  شيفت {s.shiftNumber === 'ONE' ? 'صباحي' : s.shiftNumber === 'TWO' ? 'مسائي' : s.shiftNumber === 'THREE' ? 'ليلي' : '?'}
                                  {' · '}
                                  {s.status === 'ACTIVE' ? 'نشطة' : s.status === 'PENDING_END' ? 'بانتظار الإغلاق' : s.status === 'COMPLETED' ? 'مكتملة' : s.status}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-center font-mono text-xs font-bold text-blue-700">
                    {fmtHours(row.weekMinutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-4 text-[11px] text-gray-500 flex-wrap">
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-amber-100 border border-amber-200" /> صباحي (٦-٢)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-sky-100 border border-sky-200" /> مسائي (٢-١٠)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-indigo-100 border border-indigo-200" /> ليلي (١٠-٦)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-200" /> ● جلسة نشطة الآن
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-blue-50 border border-blue-200 border-dashed" /> مجدول (لم يسجّل دخول بعد)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-gray-100 border border-gray-100" /> لم يداوم / إجازة
        </span>
      </div>
    </div>
  )
}
