'use client'
import { useEffect, useState, useCallback } from 'react'
import { Loader2, Sparkles, Gift, X, Save, RefreshCw, AlertTriangle, TrendingUp, Award, Trophy, Trash2, Lock, ChevronDown } from 'lucide-react'
import { fmtSyriaDate, fmtSyria } from '@/lib/datetime'
import { fmtSYP } from '@/lib/currency'

interface BonusEntry {
  id: string
  type: 'GROUP' | 'MANUAL'
  amount: number
  reason: string | null
  appliedAt: string
  weekStart: string | null
  createdBy: { id: string; name: string } | null
  isPaid: boolean
}

interface EmployeeRow {
  id: string
  name: string
  jobTitle: string | null
  employeeCode: string | null
  avatarUrl: string | null
  cumulativeAmount: number
  cumulativeWeeks: number
  lastErrorWeek: string | null
  groupAmount: number
  manualAmount: number
  manualBonusCount: number
  total: number
  periodErrors: number
  bonuses: BonusEntry[]
}

interface RecentBonus {
  id: string
  type: 'GROUP' | 'MANUAL'
  amount: number
  reason: string | null
  appliedAt: string
  user: { id: string; name: string; employeeCode: string | null }
  createdBy: { id: string; name: string } | null
  isPaid: boolean
}

export default function BonusesDashboardPage() {
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); d.setHours(0, 0, 0, 0)
    return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [recent, setRecent] = useState<RecentBonus[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [showGroup, setShowGroup] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [groupForm, setGroupForm] = useState({ amount: '', reason: '', userIds: new Set<string>() })
  const [manualForm, setManualForm] = useState({ userId: '', amount: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/bonuses/dashboard?from=${from}&to=${to}`)
    const d = await r.json()
    if (d.success) {
      setEmployees(d.employees)
      setRecent(d.recent)
    }
    setLoading(false)
  }, [from, to])

  useEffect(() => { load() }, [load])

  async function saveGroupBonus() {
    if (groupForm.userIds.size === 0 || !groupForm.amount) return
    setSaving(true); setMsg('')
    try {
      const res = await fetch('/api/bonuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'GROUP',
          amount: parseFloat(groupForm.amount),
          reason: groupForm.reason || undefined,
          userIds: Array.from(groupForm.userIds),
        }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setMsg(`أُضيفت مكافأة لـ ${d.count} موظف`)
      setShowGroup(false)
      setGroupForm({ amount: '', reason: '', userIds: new Set() })
      load()
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    } finally { setSaving(false) }
  }

  async function deleteBonus(b: RecentBonus) {
    if (b.isPaid) {
      alert('لا يمكن حذف مكافأة تم دفع راتب أسبوعها بالفعل.')
      return
    }
    if (!confirm(`حذف المكافأة (${b.type === 'GROUP' ? 'جماعية' : 'فردية'}) لـ ${b.user.name}؟`)) return
    try {
      const res = await fetch(`/api/bonuses?id=${b.id}`, { method: 'DELETE' })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setMsg(`حُذفت المكافأة لـ ${b.user.name}`)
      load()
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function deleteBonusById(b: BonusEntry, employeeName: string) {
    if (b.isPaid) {
      alert('لا يمكن حذف مكافأة تم دفع راتب أسبوعها بالفعل.')
      return
    }
    if (!confirm(`حذف هذه المكافأة (${b.type === 'GROUP' ? 'جماعية' : 'فردية'} ${b.amount.toLocaleString('en')} ل.س) من ${employeeName}؟`)) return
    try {
      const res = await fetch(`/api/bonuses?id=${b.id}`, { method: 'DELETE' })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setMsg(`حُذفت المكافأة من ${employeeName}`)
      load()
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function saveManualBonus() {
    if (!manualForm.userId || !manualForm.amount) return
    setSaving(true); setMsg('')
    try {
      const res = await fetch('/api/bonuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'MANUAL',
          userId: manualForm.userId,
          amount: parseFloat(manualForm.amount),
          reason: manualForm.reason || undefined,
        }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setMsg('أُضيفت المكافأة')
      setShowManual(false)
      setManualForm({ userId: '', amount: '', reason: '' })
      load()
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    } finally { setSaving(false) }
  }

  // Stats
  const totals = {
    cumulative: employees.reduce((s, e) => s + e.cumulativeAmount, 0),
    group: employees.reduce((s, e) => s + e.groupAmount, 0),
    manual: employees.reduce((s, e) => s + e.manualAmount, 0),
    grand: employees.reduce((s, e) => s + e.total, 0),
    errorCount: employees.reduce((s, e) => s + e.periodErrors, 0),
  }
  const topEarners = [...employees].sort((a, b) => b.total - a.total).slice(0, 3)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">داشبورد المكافآت</h1>
          <p className="text-sm text-gray-500 mt-0.5">نظرة شاملة على المكافآت التراكمية والجماعية والفردية</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input py-1 text-sm w-auto" title="من" />
          <span className="text-gray-400 text-xs">←</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input py-1 text-sm w-auto" title="إلى" />
          <div className="inline-flex rounded-xl bg-gray-50 p-0.5 text-[11px]">
            {[{ label: '٧ أيام', days: 7 }, { label: '٣٠ يوماً', days: 30 }, { label: '٩٠ يوماً', days: 90 }].map(p => (
              <button key={p.days} onClick={() => {
                const d = new Date(); d.setHours(0, 0, 0, 0)
                const f = new Date(d); f.setDate(d.getDate() - p.days + 1)
                setFrom(f.toISOString().slice(0, 10))
                setTo(d.toISOString().slice(0, 10))
              }} className="px-2 py-1 rounded-lg text-gray-600 hover:bg-white">{p.label}</button>
            ))}
          </div>
          <button onClick={load} className="btn-secondary btn-sm" title="تحديث">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`text-sm px-4 py-2 rounded-lg ${msg.startsWith('خطأ') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{msg}</div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-amber-500 font-bold uppercase">تراكمي</p>
            <Sparkles size={14} className="text-amber-500" />
          </div>
          <p className="text-xl font-bold text-amber-700 font-mono">{fmtSYP(totals.cumulative)}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-blue-500 font-bold uppercase">جماعية</p>
            <Gift size={14} className="text-blue-500" />
          </div>
          <p className="text-xl font-bold text-blue-700 font-mono">{fmtSYP(totals.group)}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-purple-500 font-bold uppercase">فردية</p>
            <Award size={14} className="text-purple-500" />
          </div>
          <p className="text-xl font-bold text-purple-700 font-mono">{fmtSYP(totals.manual)}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-emerald-500 font-bold uppercase">الإجمالي</p>
            <TrendingUp size={14} className="text-emerald-500" />
          </div>
          <p className="text-xl font-bold text-emerald-700 font-mono">{fmtSYP(totals.grand)}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-rose-500 font-bold uppercase">أخطاء الفترة</p>
            <AlertTriangle size={14} className="text-rose-500" />
          </div>
          <p className="text-xl font-bold text-rose-700 font-mono">{totals.errorCount}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setShowGroup(true)} className="btn-primary btn-sm">
          <Gift size={14} /> مكافأة جماعية
        </button>
        <button onClick={() => setShowManual(true)} className="btn-secondary btn-sm">
          <Award size={14} /> مكافأة فردية
        </button>
        <span className="text-[11px] text-gray-400 inline-flex items-center gap-1 mr-auto">
          <Sparkles size={11} className="text-amber-500" />
          المكافأة التراكمية محسوبة لحظياً (٥٬٠٠٠ ل.س لكل أسبوع نظيف)
        </span>
      </div>

      {/* Top earners */}
      {!loading && topEarners.length > 0 && totals.grand > 0 && (
        <div className="card p-4 bg-gradient-to-l from-amber-50 to-white">
          <div className="flex items-center gap-2 mb-3">
            <Trophy size={16} className="text-amber-500" />
            <h2 className="font-bold text-gray-800">أعلى المكافآت في الفترة</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {topEarners.map((e, idx) => (
              <div key={e.id} className="flex items-center gap-3 bg-white rounded-xl p-3 border border-amber-100">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-white ${
                  idx === 0 ? 'bg-amber-500' : idx === 1 ? 'bg-gray-400' : 'bg-amber-700'
                }`}>{idx + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-sm truncate">{e.name}</p>
                  <p className="text-[11px] text-gray-500 truncate">{e.jobTitle || '—'}</p>
                </div>
                <p className="font-bold text-amber-700 font-mono text-sm">{fmtSYP(e.total)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Employee table */}
      {loading ? (
        <div className="card p-12 text-center text-gray-400">
          <Loader2 size={28} className="mx-auto animate-spin mb-2" /> جاري التحميل...
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">الموظف</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">تراكمي</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">جماعية</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">فردية</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">الإجمالي</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">أخطاء</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(e => {
                const expanded = expandedRow === e.id
                const hasDetails = e.bonuses.length > 0
                return (
                  <>
                    <tr key={e.id}
                      className={`border-t border-gray-100 ${hasDetails ? 'cursor-pointer' : ''} ${expanded ? 'bg-blue-50/40' : 'hover:bg-blue-50/30'}`}
                      onClick={() => hasDetails && setExpandedRow(expanded ? null : e.id)}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {hasDetails && (
                            <ChevronDown size={12} className={`text-gray-400 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                          )}
                          {e.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={e.avatarUrl} alt={e.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                              {e.name.charAt(0)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate text-xs">{e.name}</p>
                            <p className="text-[10px] text-gray-400 font-mono">{e.employeeCode}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <p className="font-mono text-amber-700 font-bold">{fmtSYP(e.cumulativeAmount)}</p>
                        <p className="text-[10px] text-gray-400">{e.cumulativeWeeks} أسبوع نظيف</p>
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-blue-700">
                        {e.groupAmount > 0 ? `+${fmtSYP(e.groupAmount)}` : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-purple-700">
                        {e.manualAmount > 0 ? <>+{fmtSYP(e.manualAmount)}<p className="text-[10px] text-gray-400">{e.manualBonusCount} مكافأة</p></> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center font-mono font-bold text-emerald-700">
                        {fmtSYP(e.total)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {e.periodErrors > 0
                          ? <span className="badge bg-rose-100 text-rose-700">{e.periodErrors}</span>
                          : <span className="text-gray-300 text-xs">—</span>
                        }
                      </td>
                    </tr>
                    {/* Expanded detail row — list of bonuses with delete actions */}
                    {expanded && hasDetails && (
                      <tr key={`${e.id}-details`} className="bg-blue-50/20 border-b border-blue-100">
                        <td colSpan={6} className="px-4 py-3">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                            تفاصيل المكافآت في الفترة ({e.bonuses.length})
                          </p>
                          <div className="space-y-1.5">
                            {e.bonuses.map(b => (
                              <div key={b.id} className="bg-white border border-gray-100 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`badge text-[10px] shrink-0 ${b.type === 'GROUP' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                                    {b.type === 'GROUP' ? 'جماعية' : 'فردية'}
                                  </span>
                                  {b.reason
                                    ? <span className="text-xs text-gray-700 truncate">{b.reason}</span>
                                    : <span className="text-xs text-gray-400 italic">بدون سبب</span>
                                  }
                                  {b.weekStart && (
                                    <span className="text-[10px] text-gray-400 font-mono">
                                      أسبوع {fmtSyriaDate(b.weekStart)}
                                    </span>
                                  )}
                                  {b.isPaid && (
                                    <span className="badge bg-emerald-100 text-emerald-700 text-[9px] inline-flex items-center gap-0.5 shrink-0">
                                      <Lock size={9} /> مدفوعة
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <span className="font-mono font-bold text-emerald-700">+{fmtSYP(b.amount)}</span>
                                  <span className="text-[10px] text-gray-400 hidden md:inline">
                                    {fmtSyria(b.appliedAt, false)}
                                    {b.createdBy && ` · ${b.createdBy.name}`}
                                  </span>
                                  {b.isPaid ? (
                                    <span className="w-7" />
                                  ) : (
                                    <button
                                      onClick={(ev) => { ev.stopPropagation(); deleteBonusById(b, e.name) }}
                                      className="btn-ghost btn-sm p-1.5 text-rose-500 hover:bg-rose-50"
                                      title="حذف هذه المكافأة"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent activity */}
      {recent.length > 0 && (
        <div className="card p-4">
          <h2 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
            <Award size={16} className="text-blue-500" />
            آخر المكافآت في الفترة
          </h2>
          <ul className="space-y-2">
            {recent.map(r => (
              <li key={r.id} className="flex items-center justify-between text-sm border-b border-gray-50 last:border-0 pb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`badge text-[10px] shrink-0 ${r.type === 'GROUP' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                    {r.type === 'GROUP' ? 'جماعية' : 'فردية'}
                  </span>
                  <span className="font-medium text-gray-700 truncate">{r.user.name}</span>
                  {r.reason && <span className="text-xs text-gray-500 truncate">— {r.reason}</span>}
                  {r.isPaid && (
                    <span className="badge bg-emerald-100 text-emerald-700 text-[9px] inline-flex items-center gap-0.5 shrink-0">
                      <Lock size={9} /> مدفوعة
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono font-bold text-emerald-700">+{fmtSYP(r.amount)}</span>
                  <span className="text-[11px] text-gray-400 font-mono hidden md:inline">{fmtSyria(r.appliedAt, false)}</span>
                  {r.isPaid ? (
                    <span className="w-7" /> /* spacer keeps alignment */
                  ) : (
                    <button onClick={() => deleteBonus(r)}
                      className="btn-ghost btn-sm p-1.5 text-rose-500 hover:bg-rose-50"
                      title="حذف هذه المكافأة">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
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
                <input type="number" step="1000" className="input font-mono"
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
                  <button onClick={() => setGroupForm(f => ({ ...f, userIds: new Set(employees.map(e => e.id)) }))} className="text-xs text-blue-600">اختيار الكل</button>
                </div>
                <div className="border border-gray-200 rounded-xl p-2 max-h-60 overflow-y-auto space-y-1">
                  {employees.map(e => {
                    const checked = groupForm.userIds.has(e.id)
                    return (
                      <label key={e.id} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
                        <input type="checkbox" checked={checked} onChange={() => {
                          setGroupForm(f => {
                            const n = new Set(f.userIds)
                            if (n.has(e.id)) n.delete(e.id); else n.add(e.id)
                            return { ...f, userIds: n }
                          })
                        }} />
                        <span className="text-sm">{e.name}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
              <button onClick={saveGroupBonus} disabled={saving || !groupForm.amount || groupForm.userIds.size === 0} className="btn-primary w-full justify-center">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                إضافة المكافأة لـ {groupForm.userIds.size} موظف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual bonus modal */}
      {showManual && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2"><Award size={18} /> مكافأة فردية</h2>
              <button onClick={() => setShowManual(false)} className="btn-ghost p-1.5"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">الموظف *</label>
                <select className="input" value={manualForm.userId}
                  onChange={e => setManualForm(f => ({ ...f, userId: e.target.value }))}>
                  <option value="">— اختر موظفاً —</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.name}{e.employeeCode ? ` (${e.employeeCode})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">المبلغ (ل.س) *</label>
                <input type="number" step="1000" className="input font-mono"
                  value={manualForm.amount}
                  onChange={e => setManualForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">السبب (اختياري)</label>
                <input className="input" value={manualForm.reason}
                  onChange={e => setManualForm(f => ({ ...f, reason: e.target.value }))} />
              </div>
              <button onClick={saveManualBonus} disabled={saving || !manualForm.userId || !manualForm.amount} className="btn-primary w-full justify-center">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                إضافة المكافأة
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-[10px] text-gray-400 text-center">
        فترة: {fmtSyriaDate(from)} ← {fmtSyriaDate(to)}
      </p>
    </div>
  )
}
