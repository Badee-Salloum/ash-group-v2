'use client'
// Payroll tab of /compensation. Mirrors the legacy /payroll page; only the
// modal imports were rewritten to point at the original /payroll/_components
// directory (which still lives in the tree as a shared module).
import { SortableTable } from '@/components/tables/SortableTable'
import { useEffect, useState, useCallback } from 'react'
import { Loader2, RefreshCw, DollarSign, Sparkles, ChevronRight, ChevronLeft, Pencil } from 'lucide-react'
import { EditPayrollModal, EditPayrollTarget } from '../../payroll/_components/EditPayrollModal'
import { fmtSyriaDate } from '@/lib/datetime'
import { fmtSYP } from '@/lib/currency'

interface Entry {
  id: string
  userId: string
  user: { id: string; name: string; jobTitle: string | null; employeeCode: string | null; avatarUrl: string | null; baseSalary: number | null }
  weekStart: string
  weekEnd: string
  baseSalary: number
  workedHours: number
  expectedHours: number
  bonusAmount: number
  advanceAmount: number
  deductions: number
  netAmount: number
  status: 'DRAFT' | 'CONFIRMED' | 'PAID'
  paidAt: string | null
  notes: string | null
}

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'مسودة', cls: 'bg-gray-100 text-gray-700' },
  CONFIRMED: { label: 'معتمد', cls: 'bg-blue-100 text-blue-700' },
  PAID: { label: 'مدفوع', cls: 'bg-emerald-100 text-emerald-700' },
}

// Local-calendar Sunday-aligned YYYY-MM-DD. We anchor on noon to dodge
// the UTC midnight ↔ Damascus +3 trap that used to skip whole weeks
// when changeWeek parsed an ISO date string and got back tomorrow.
function startOfWeek(d: Date | string): string {
  let dt: Date
  if (typeof d === 'string') {
    // Parse "YYYY-MM-DD" as local noon so getDay() reflects the date
    // the user actually sees, not the UTC interpretation.
    dt = new Date(`${d}T12:00:00`)
  } else {
    dt = new Date(d.getTime())
    dt.setHours(12, 0, 0, 0)
  }
  const day = dt.getDay()
  dt.setDate(dt.getDate() - day)
  // Build the ISO date manually — toISOString() would shift back to UTC.
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const da = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

// Pure string math: add N days to a YYYY-MM-DD string. Avoids the same
// timezone trap on every navigation click.
function addDaysISO(iso: string, days: number): string {
  const dt = new Date(`${iso}T12:00:00`)
  dt.setDate(dt.getDate() + days)
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const da = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

// ISO 8601 week number (1..53) — same algorithm as date-fns getISOWeek
function isoWeekNumber(d: Date): number {
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

type ViewMode = 'week' | 'range'

interface PayrollTabProps {
  // Optional filter chip applied on first load — currently supports
  // 'unpaid' (rows where status !== 'PAID'). Set when the user clicks
  // "الذهاب للرواتب" on the Overview tab's PendingDuesCard.
  initialFilter?: string | null
}

export function PayrollTab({ initialFilter }: PayrollTabProps = {}) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'unpaid'>(
    initialFilter === 'unpaid' ? 'unpaid' : 'all',
  )
  const [mode, setMode] = useState<ViewMode>('week')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  // Range mode: default to last 30 days
  const [rangeFrom, setRangeFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); d.setHours(0,0,0,0)
    return d.toISOString().slice(0, 10)
  })
  const [rangeTo, setRangeTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [msg, setMsg] = useState('')

  // Inline row-edit modal — the deduction quick-add lives on the
  // Bonuses & Deductions tab now.
  const [editingPayroll, setEditingPayroll] = useState<EditPayrollTarget | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const url = mode === 'range'
      ? `/api/payroll?from=${rangeFrom}&to=${rangeTo}`
      : `/api/payroll?weekStart=${weekStart}`
    const r = await fetch(url)
    const d = await r.json()
    if (d.success) setEntries(d.data)
    setLoading(false)
  }, [mode, weekStart, rangeFrom, rangeTo])

  useEffect(() => { load() }, [load])

  async function generate() {
    setWorking(true); setMsg('')
    try {
      const r = await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart }),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error)
      setMsg(`تم — أنشئ ${d.created} وحُدِّث ${d.refreshed}`)
      load()
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setWorking(false)
    }
  }

  async function accrueCumulative() {
    setWorking(true); setMsg('')
    try {
      const r = await fetch('/api/bonuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'CUMULATIVE', weekStart, baseIncrement: 5000 }),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error)
      setMsg(`تراكمت لـ ${d.accrued} موظف، تصفّرت لـ ${d.reset}`)
      load()
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setWorking(false)
    }
  }

  // Mark-paid + unpay live on the Overview tab's scorecard now; the
  // Payroll tab here is read-only edit (deductions, notes) — no status
  // flips and no group-bonus shortcut.
  function changeWeek(delta: number) {
    // Pure string math (no Date parsing) so we never trip over the
    // UTC ↔ Damascus offset. weekStart is already Sunday-aligned, so
    // adding/subtracting 7 days lands on another Sunday — no need to
    // re-snap via startOfWeek.
    setWeekStart(addDaysISO(weekStart, delta * 7))
  }

  // Is the displayed week the current real-world week? Used to enable
  // the "next week" button and conditionally show the "back to current"
  // shortcut.
  const todayWeek = startOfWeek(new Date())
  const isCurrentWeek = weekStart === todayWeek
  const isFutureWeek = weekStart > todayWeek

  const totals = {
    base: entries.reduce((s, e) => s + e.baseSalary, 0),
    bonus: entries.reduce((s, e) => s + e.bonusAmount, 0),
    net: entries.reduce((s, e) => s + e.netAmount, 0),
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">الرواتب</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {mode === 'week' ? (
              <>
                الأسبوع <span className="font-mono font-bold">{isoWeekNumber(new Date(`${weekStart}T12:00:00`))}</span>
                <span className="text-gray-400 mx-1.5">·</span>
                {fmtSyriaDate(weekStart)}
              </>
            ) : (
              <>
                فترة من <span className="font-mono">{fmtSyriaDate(rangeFrom)}</span>
                <span className="text-gray-400 mx-1.5">←</span>
                <span className="font-mono">{fmtSyriaDate(rangeTo)}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Mode toggle */}
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
              {/* Redesigned week navigator: text-labelled buttons + clickable
                  chip that doubles as a date picker. Next button is gated by
                  isCurrentWeek so there's no jump into future weeks. */}
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
              {/* Quick presets */}
              <div className="inline-flex rounded-xl bg-gray-50 p-0.5 text-[11px]">
                {[
                  { label: '٧ أيام', days: 7 },
                  { label: '٣٠ يوماً', days: 30 },
                  { label: '٩٠ يوماً', days: 90 },
                ].map(p => (
                  <button key={p.days} onClick={() => {
                    const d = new Date(); d.setHours(0,0,0,0)
                    const f = new Date(d); f.setDate(d.getDate() - p.days + 1)
                    setRangeFrom(f.toISOString().slice(0,10))
                    setRangeTo(d.toISOString().slice(0,10))
                  }} className="px-2 py-1 rounded-lg text-gray-600 hover:bg-white">{p.label}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card p-4 flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          مباشر — يتجدّد عند كل عرض
        </span>
        <button onClick={() => load()} disabled={working} className="btn-secondary btn-sm" title="تحديث الآن">
          {working ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          تحديث
        </button>
        <span className="text-[11px] text-gray-400 inline-flex items-center gap-1" title="عند كل عرض، يُحسب تراكم المكافأة بناءً على عدد الأسابيع المتتالية بدون أخطاء">
          <Sparkles size={11} className="text-amber-500" />
          التراكم محسوب مباشرة من سجل الأخطاء
        </span>
      </div>

      {msg && (
        <div className={`text-sm px-4 py-2 rounded-lg ${msg.startsWith('خطأ') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{msg}</div>
      )}

      {/* Salary-focused totals — bonuses live in the Bonuses tab. The
          "net" shown here strips out the bonus portion so the figure
          reads as "salary owed for work performed", not the gross payout. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="text-[10px] text-gray-400 font-bold uppercase">الأساسي الإجمالي</p>
          <p className="text-xl font-bold font-mono">{fmtSYP(totals.base)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] text-blue-500 font-bold uppercase">الصافي بعد الخصومات</p>
          <p className="text-xl font-bold text-blue-700 font-mono">{fmtSYP(totals.net - totals.bonus)}</p>
        </div>
      </div>

      {/* Active filter chip — appears when arriving via Overview's
          "الذهاب للرواتب" CTA (?filter=unpaid). User can clear it. */}
      {statusFilter === 'unpaid' && (
        <div className="inline-flex items-center gap-2 text-xs bg-amber-50 text-amber-800 ring-1 ring-amber-200 rounded-lg px-2.5 py-1">
          <span className="font-semibold">عرض غير المدفوع فقط</span>
          <button onClick={() => setStatusFilter('all')} className="text-amber-700 hover:text-amber-900">
            ✕ مسح
          </button>
        </div>
      )}

      {loading ? (
        <div className="card p-12 text-center text-gray-400">
          <Loader2 size={28} className="mx-auto animate-spin mb-2" /> جاري التحميل...
        </div>
      ) : entries.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <DollarSign size={28} className="mx-auto mb-2 opacity-30" />
          لا يوجد موظفون نشطون.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <SortableTable className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">الموظف</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">
                  أيام دوام / المطلوبة
                </th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">أساسي</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">خصومات</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">الصافي</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">الحالة</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {(statusFilter === 'unpaid' ? entries.filter(e => e.status !== 'PAID') : entries).map(e => (
                <tr key={e.id} className="border-t border-gray-100">
                  <td data-sort-value={e.user?.name} className="px-3 py-2">
                    <div className="font-medium">{e.user?.name}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{e.user?.employeeCode}</div>
                  </td>
                  <td data-sort-value={e.workedHours} className="px-3 py-2 text-center font-mono text-xs">{Math.round(e.workedHours)} / {Math.round(e.expectedHours)}</td>
                  <td data-sort-value={e.baseSalary} className="px-3 py-2 text-center font-mono">{fmtSYP(e.baseSalary)}</td>
                  <td data-sort-value={e.deductions} className="px-3 py-2 text-center font-mono text-rose-700">−{fmtSYP(e.deductions)}</td>
                  <td data-sort-value={e.netAmount - e.bonusAmount} className="px-3 py-2 text-center font-mono font-bold">{fmtSYP(e.netAmount - e.bonusAmount)}</td>
                  <td className="px-3 py-2 text-center"><span className={`badge ${STATUS[e.status].cls}`}>{STATUS[e.status].label}</span></td>
                  <td className="px-3 py-2 text-center">
                    <div className="inline-flex items-center gap-2">
                      <button
                        onClick={() => setEditingPayroll({
                          id: e.id,
                          userName: e.user?.name || '—',
                          weekLabel: mode === 'week'
                            ? `الأسبوع ${e.weekStart.slice(0, 10)}`
                            : `${e.weekStart.slice(0, 10)} ← ${e.weekEnd.slice(0, 10)}`,
                          baseSalary: e.baseSalary,
                          workedHours: e.workedHours,
                          expectedHours: e.expectedHours,
                          bonusAmount: e.bonusAmount,
                          deductions: e.deductions,
                          advanceAmount: e.advanceAmount,
                          netAmount: e.netAmount,
                          status: e.status,
                          notes: e.notes,
                        })}
                        className="text-blue-500 hover:text-blue-700 p-1 rounded"
                        title="تعديل الخصومات والملاحظات"
                      >
                        <Pencil size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </SortableTable>
        </div>
      )}

      {/* Inline edit-payroll modal */}
      {editingPayroll && (
        <EditPayrollModal
          target={editingPayroll}
          onClose={() => setEditingPayroll(null)}
          onSaved={() => { setEditingPayroll(null); load() }}
        />
      )}

    </div>
  )
}
