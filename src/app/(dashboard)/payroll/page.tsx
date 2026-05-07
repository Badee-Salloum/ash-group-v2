'use client'
import { useEffect, useState, useCallback } from 'react'
import { Loader2, RefreshCw, DollarSign, Sparkles, Gift, X, Save, ChevronRight, ChevronLeft } from 'lucide-react'
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

function startOfWeek(d: Date): string {
  const day = d.getDay()
  const m = new Date(d); m.setDate(d.getDate() - day); m.setHours(0,0,0,0)
  return m.toISOString().slice(0, 10)
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

export default function PayrollPage() {
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

  const [showGroup, setShowGroup] = useState(false)
  const [groupForm, setGroupForm] = useState({ amount: '', reason: '', userIds: new Set<string>() })

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

  async function saveGroupBonus() {
    if (groupForm.userIds.size === 0 || !groupForm.amount) return
    setWorking(true); setMsg('')
    try {
      const r = await fetch('/api/bonuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'GROUP',
          amount: parseFloat(groupForm.amount),
          reason: groupForm.reason || undefined,
          userIds: Array.from(groupForm.userIds),
          weekStart,
        }),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error)
      setMsg(`أُضيفت مكافأة لـ ${d.count} موظف`)
      setShowGroup(false)
      setGroupForm({ amount: '', reason: '', userIds: new Set() })
      load()
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setWorking(false)
    }
  }

  async function markPaid(id: string) {
    if (!confirm('تأكيد دفع هذا الراتب؟')) return
    const r = await fetch('/api/payroll', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'PAID' }),
    })
    const d = await r.json()
    if (d.success) load()
    else alert('خطأ: ' + d.error)
  }

  function changeWeek(delta: number) {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + delta * 7)
    setWeekStart(startOfWeek(d))
  }

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
                الأسبوع <span className="font-mono font-bold">{isoWeekNumber(new Date(weekStart))}</span>
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
              {/* Week summary chip — number + start/end dates */}
              {(() => {
                const ws = new Date(weekStart)
                const we = new Date(ws); we.setDate(ws.getDate() + 6)
                return (
                  <span className="inline-flex items-center gap-2 bg-blue-50 text-blue-800 px-3 py-1.5 rounded-xl text-xs font-medium">
                    <span>الأسبوع <span className="font-mono font-bold">{isoWeekNumber(ws)}</span></span>
                    <span className="text-blue-300">·</span>
                    <span className="font-mono">{fmtSyriaDate(ws)}</span>
                    <span className="text-blue-300">←</span>
                    <span className="font-mono">{fmtSyriaDate(we)}</span>
                  </span>
                )
              })()}
              {/* RTL-correct: ChevronRight (visually points right) goes BACK */}
              <button onClick={() => changeWeek(-1)} className="btn-secondary btn-sm" title="الأسبوع السابق">
                <ChevronRight size={14} />
              </button>
              <input type="date" value={weekStart} onChange={e => setWeekStart(e.target.value)} className="input py-1 text-sm w-auto" />
              <button onClick={() => changeWeek(1)} className="btn-secondary btn-sm" title="الأسبوع التالي">
                <ChevronLeft size={14} />
              </button>
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
        <button onClick={() => setShowGroup(true)} className="btn-secondary btn-sm">
          <Gift size={14} /> مكافأة جماعية
        </button>
      </div>

      {msg && (
        <div className={`text-sm px-4 py-2 rounded-lg ${msg.startsWith('خطأ') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{msg}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-[10px] text-gray-400 font-bold uppercase">الأساسي الإجمالي</p>
          <p className="text-xl font-bold font-mono">{fmtSYP(totals.base)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] text-emerald-500 font-bold uppercase">المكافآت</p>
          <p className="text-xl font-bold text-emerald-700 font-mono">{fmtSYP(totals.bonus)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] text-blue-500 font-bold uppercase">الصافي</p>
          <p className="text-xl font-bold text-blue-700 font-mono">{fmtSYP(totals.net)}</p>
        </div>
      </div>

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
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">الموظف</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">
                  {mode === 'range' ? 'أيام دوام / المتوقّعة' : 'أيام دوام'}
                </th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">أساسي</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">مكافأة</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">خصومات</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">الصافي</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">الحالة</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <div className="font-medium">{e.user?.name}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{e.user?.employeeCode}</div>
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-xs">{Math.round(e.workedHours)} / {Math.round(e.expectedHours)}</td>
                  <td className="px-3 py-2 text-center font-mono">{fmtSYP(e.baseSalary)}</td>
                  <td className="px-3 py-2 text-center font-mono text-emerald-700">+{fmtSYP(e.bonusAmount)}</td>
                  <td className="px-3 py-2 text-center font-mono text-rose-700">−{fmtSYP(e.deductions)}</td>
                  <td className="px-3 py-2 text-center font-mono font-bold">{fmtSYP(e.netAmount)}</td>
                  <td className="px-3 py-2 text-center"><span className={`badge ${STATUS[e.status].cls}`}>{STATUS[e.status].label}</span></td>
                  <td className="px-3 py-2 text-center">
                    {e.status !== 'PAID' && (
                      <button onClick={() => markPaid(e.id)} className="text-xs text-emerald-700 hover:underline">دفع</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Group bonus modal */}
      {showGroup && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2"><Gift size={18} /> مكافأة جماعية</h2>
              <button onClick={() => setShowGroup(false)} className="btn-ghost p-1.5"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">المبلغ لكل موظف (ل.س)</label>
                <input type="number" step="0.01" className="input font-mono"
                  value={groupForm.amount}
                  onChange={e => setGroupForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">السبب (اختياري)</label>
                <input className="input" value={groupForm.reason}
                  onChange={e => setGroupForm(f => ({ ...f, reason: e.target.value }))} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">الموظفون ({groupForm.userIds.size})</label>
                  <button onClick={() => setGroupForm(f => ({ ...f, userIds: new Set(entries.map(e => e.userId)) }))} className="text-xs text-blue-600">اختيار الكل</button>
                </div>
                <div className="border border-gray-200 rounded-xl p-2 max-h-60 overflow-y-auto space-y-1">
                  {entries.map(e => {
                    const checked = groupForm.userIds.has(e.userId)
                    return (
                      <label key={e.userId} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
                        <input type="checkbox" checked={checked} onChange={() => {
                          setGroupForm(f => {
                            const n = new Set(f.userIds)
                            if (n.has(e.userId)) n.delete(e.userId)
                            else n.add(e.userId)
                            return { ...f, userIds: n }
                          })
                        }} />
                        <span className="text-sm">{e.user?.name}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
              <button onClick={saveGroupBonus} disabled={working || !groupForm.amount || groupForm.userIds.size === 0} className="btn-primary w-full justify-center">
                {working ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                إضافة المكافأة لـ {groupForm.userIds.size} موظف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
