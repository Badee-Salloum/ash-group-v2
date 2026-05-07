'use client'
import { useEffect, useState, useCallback } from 'react'
import { Calendar, Save, Loader2, Sparkles, Trash2 } from 'lucide-react'

interface Shift {
  id: string
  date: string
  shiftNumber: 'ONE' | 'TWO' | 'THREE'
  userId: string
  user: { id: string; name: string; jobTitle: string | null; avatarUrl: string | null }
  isDayOff: boolean
}

interface Employee { id: string; name: string; jobTitle?: string | null; avatarUrl?: string | null }

function toShiftUser(e?: Employee): Shift['user'] {
  return {
    id: e?.id || '',
    name: e?.name || '',
    jobTitle: e?.jobTitle ?? null,
    avatarUrl: e?.avatarUrl ?? null,
  }
}

const SHIFT_LABEL: Record<string, { label: string; cls: string }> = {
  ONE: { label: '06:00 → 14:00', cls: 'bg-amber-50 border-amber-200' },
  TWO: { label: '14:00 → 22:00', cls: 'bg-sky-50 border-sky-200' },
  THREE: { label: '22:00 → 06:00', cls: 'bg-indigo-50 border-indigo-200' },
}

const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - day)
  monday.setHours(0, 0, 0, 0)
  return monday
}

export default function SchedulePage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [shifts, setShifts] = useState<Shift[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [minPerShift, setMinPerShift] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    return d
  })

  const load = useCallback(async () => {
    setLoading(true)
    const from = days[0].toISOString().slice(0, 10)
    const to = days[6].toISOString().slice(0, 10)
    const [s, e] = await Promise.all([
      fetch(`/api/schedule?from=${from}&to=${to}`).then(r => r.json()),
      fetch('/api/employees').then(r => r.json()),
    ])
    if (s.success) setShifts(s.data)
    if (e.success) setEmployees(e.data || [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  useEffect(() => { load() }, [load])

  function getShifts(dateStr: string, sn: 'ONE' | 'TWO' | 'THREE') {
    return shifts.filter(s => s.date.slice(0, 10) === dateStr && s.shiftNumber === sn)
  }

  function assign(dateStr: string, sn: 'ONE' | 'TWO' | 'THREE', userId: string) {
    if (!userId) return
    setShifts(prev => [
      ...prev,
      {
        id: `tmp-${Date.now()}`,
        date: dateStr,
        shiftNumber: sn,
        userId,
        user: toShiftUser(employees.find(e => e.id === userId)),
        isDayOff: false,
      },
    ])
  }

  function remove(shiftId: string) {
    setShifts(prev => prev.filter(s => s.id !== shiftId))
  }

  async function handleSuggest() {
    setLoading(true)
    const from = days[0].toISOString().slice(0, 10)
    const r = await fetch(`/api/schedule?action=suggest&from=${from}&minPerShift=${minPerShift}`, { method: 'POST' })
    const d = await r.json()
    if (d.success) {
      const tmp: Shift[] = d.data.map((s: { date: string; shiftNumber: 'ONE'|'TWO'|'THREE'; userId: string; isDayOff: boolean }, i: number) => ({
        id: `tmp-${i}-${Date.now()}`,
        date: s.date,
        shiftNumber: s.shiftNumber,
        userId: s.userId,
        user: toShiftUser(employees.find(e => e.id === s.userId)),
        isDayOff: s.isDayOff,
      }))
      setShifts(tmp)
    }
    setLoading(false)
  }

  async function handleSave() {
    setSaving(true); setMsg('')
    try {
      const payload = {
        shifts: shifts.map(s => ({
          date: s.date.slice(0, 10),
          shiftNumber: s.shiftNumber,
          userId: s.userId,
          isDayOff: s.isDayOff,
        })),
      }
      const r = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error)
      setMsg(`تم حفظ ${d.count} مناوبة`)
      load()
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
    }
  }

  function changeWeek(delta: number) {
    const next = new Date(weekStart)
    next.setDate(weekStart.getDate() + delta * 7)
    setWeekStart(next)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">جدول المناوبات</h1>
          <p className="text-sm text-gray-500 mt-0.5">أسبوع {days[0].toLocaleDateString('ar-SY')} ← {days[6].toLocaleDateString('ar-SY')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => changeWeek(-1)} className="btn-secondary btn-sm">← الأسبوع السابق</button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))} className="btn-secondary btn-sm">الأسبوع الحالي</button>
          <button onClick={() => changeWeek(1)} className="btn-secondary btn-sm">الأسبوع التالي →</button>
        </div>
      </div>

      <div className="card p-4 flex items-center gap-3 flex-wrap">
        <span className="text-sm text-gray-600">الحد الأدنى لكل شيفت:</span>
        <input type="number" min={1} max={20} value={minPerShift}
          onChange={e => setMinPerShift(Math.max(1, parseInt(e.target.value) || 1))}
          className="input w-20 py-1 text-sm" />
        <button onClick={handleSuggest} className="btn-secondary btn-sm">
          <Sparkles size={14} /> اقتراح تلقائي
        </button>
        <div className="flex-1" />
        <button onClick={handleSave} disabled={saving || shifts.length === 0} className="btn-primary btn-sm">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          حفظ ({shifts.length})
        </button>
      </div>

      {msg && (
        <div className={`text-sm px-4 py-2 rounded-lg ${msg.startsWith('خطأ') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {msg}
        </div>
      )}

      {loading ? (
        <div className="card p-12 text-center text-gray-400">
          <Loader2 size={28} className="mx-auto animate-spin mb-2" />
          جاري التحميل...
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-3 text-right font-semibold text-gray-600 w-32">المناوبة</th>
                {days.map((d, i) => (
                  <th key={i} className="px-2 py-3 text-center font-semibold text-gray-600 min-w-[140px]">
                    <div className="text-xs">{DAY_NAMES[d.getDay()]}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{d.toISOString().slice(5, 10)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['ONE', 'TWO', 'THREE'] as const).map(sn => (
                <tr key={sn} className="border-b border-gray-100">
                  <td className={`px-3 py-3 align-top ${SHIFT_LABEL[sn].cls} border-r-4`}>
                    <div className="text-sm font-bold text-gray-700">شيفت {sn === 'ONE' ? 'أول' : sn === 'TWO' ? 'ثاني' : 'ثالث'}</div>
                    <div className="text-[10px] text-gray-500 font-mono">{SHIFT_LABEL[sn].label}</div>
                  </td>
                  {days.map((d, i) => {
                    const dateStr = d.toISOString().slice(0, 10)
                    const list = getShifts(dateStr, sn)
                    return (
                      <td key={i} className="px-2 py-2 align-top">
                        <div className="space-y-1">
                          {list.map(s => (
                            <div key={s.id} className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1 text-xs">
                              <span className="flex-1 truncate font-medium">{s.user?.name || '?'}</span>
                              <button onClick={() => remove(s.id)} className="text-red-500 hover:text-red-700">
                                <Trash2 size={11} />
                              </button>
                            </div>
                          ))}
                          <select
                            value=""
                            onChange={e => assign(dateStr, sn, e.target.value)}
                            className="text-[10px] w-full border border-gray-200 rounded px-1 py-0.5 bg-white hover:bg-gray-50"
                          >
                            <option value="">+ إضافة</option>
                            {employees.map(em => (
                              <option key={em.id} value={em.id}>{em.name}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
