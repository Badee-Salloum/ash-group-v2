'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { Save, Loader2, Sparkles, Trash2, ArrowRightLeft, X, Wallet, Check } from 'lucide-react'
import { weekStartStr, weekDays, addDays, dayOfWeek } from '@/lib/datetime'

type ShiftNum = 'ONE' | 'TWO' | 'THREE'

interface Shift {
  id: string
  date: string
  shiftNumber: ShiftNum
  userId: string
  user: { id: string; name: string; jobTitle: string | null; avatarUrl: string | null }
  isDayOff: boolean
  walletIds: string[]
}

interface Employee { id: string; name: string; jobTitle?: string | null; avatarUrl?: string | null }
interface Account { id: string; name: string; currency: string; isActive?: boolean }

function toShiftUser(e?: Employee): Shift['user'] {
  return {
    id: e?.id || '',
    name: e?.name || '',
    jobTitle: e?.jobTitle ?? null,
    avatarUrl: e?.avatarUrl ?? null,
  }
}

const SHIFT_LABEL: Record<ShiftNum, { label: string; cls: string }> = {
  ONE:   { label: '06:00 → 14:00', cls: 'bg-amber-50 border-amber-200' },
  TWO:   { label: '14:00 → 22:00', cls: 'bg-sky-50 border-sky-200' },
  THREE: { label: '22:00 → 06:00', cls: 'bg-indigo-50 border-indigo-200' },
}

const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

export default function SchedulePage() {
  // weekStart is always a YYYY-MM-DD Sunday string (Damascus calendar). Using
  // strings throughout avoids the toISOString()/getDay() timezone drift that
  // shifted the week back a day on a UTC+3 client.
  const [weekStart, setWeekStart] = useState(() => weekStartStr(new Date()))
  const [shifts, setShifts] = useState<Shift[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [minPerShift, setMinPerShift] = useState(1)
  const [defaultOffDays, setDefaultOffDays] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // Wallet picker for a specific shift cell (null when closed)
  const [walletEditing, setWalletEditing] = useState<Shift | null>(null)

  // Manual swap workflow
  const [swapMode, setSwapMode] = useState(false)
  const [swapFirst, setSwapFirst] = useState<Shift | null>(null)
  const [swapping, setSwapping] = useState(false)
  const [swapConfirm, setSwapConfirm] = useState<{ a: Shift; b: Shift } | null>(null)

  // The 7 YYYY-MM-DD day strings of the displayed week.
  const days = weekDays(weekStart)

  const load = useCallback(async () => {
    setLoading(true)
    const from = days[0]
    const to = days[6]
    const [s, e, a] = await Promise.all([
      fetch(`/api/schedule?from=${from}&to=${to}`).then(r => r.json()),
      fetch('/api/employees').then(r => r.json()),
      fetch('/api/accounts').then(r => r.json()),
    ])
    if (s.success) setShifts((s.data as Shift[]).map(x => ({ ...x, walletIds: x.walletIds || [] })))
    if (e.success) setEmployees(e.data || [])
    if (a.success) setAccounts((a.data || []).filter((acc: Account) => acc.isActive !== false))
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  useEffect(() => { load() }, [load])

  const accountById = useMemo(() => {
    const m = new Map<string, Account>()
    for (const a of accounts) m.set(a.id, a)
    return m
  }, [accounts])

  function getShifts(dateStr: string, sn: ShiftNum) {
    return shifts.filter(s => s.date.slice(0, 10) === dateStr && s.shiftNumber === sn)
  }

  function assign(dateStr: string, sn: ShiftNum, userId: string) {
    if (!userId) return
    setShifts(prev => [
      ...prev,
      {
        id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date: dateStr,
        shiftNumber: sn,
        userId,
        user: toShiftUser(employees.find(e => e.id === userId)),
        isDayOff: false,
        walletIds: [],
      },
    ])
  }

  function remove(shiftId: string) {
    setShifts(prev => prev.filter(s => s.id !== shiftId))
  }

  function updateWallets(shiftId: string, walletIds: string[]) {
    setShifts(prev => prev.map(s => s.id === shiftId ? { ...s, walletIds } : s))
  }

  async function handleSuggest() {
    setLoading(true)
    const from = days[0]
    const r = await fetch(
      `/api/schedule?action=suggest&from=${from}&minPerShift=${minPerShift}&defaultOffDays=${defaultOffDays}`,
      { method: 'POST' },
    )
    const d = await r.json()
    if (d.success) {
      const tmp: Shift[] = d.data.map((s: { date: string; shiftNumber: ShiftNum; userId: string; isDayOff: boolean }, i: number) => ({
        id: `tmp-${i}-${Date.now()}`,
        date: s.date,
        shiftNumber: s.shiftNumber,
        userId: s.userId,
        user: toShiftUser(employees.find(e => e.id === s.userId)),
        isDayOff: s.isDayOff,
        walletIds: [],
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
          walletIds: s.walletIds,
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
    setWeekStart(weekStartStr(addDays(weekStart, delta * 7)))
  }

  // ─── Swap handlers ────────────────────────────────────────────────────────
  function exitSwap() {
    setSwapMode(false); setSwapFirst(null); setSwapConfirm(null)
  }

  function pickSwapTarget(s: Shift) {
    // Swap requires both shifts to be persisted (DB ids, not tmp- locals)
    if (s.id.startsWith('tmp-')) {
      setMsg('احفظ الجدول أولاً ثم استخدم وضع التبديل')
      return
    }
    if (!swapFirst) {
      setSwapFirst(s)
      return
    }
    if (swapFirst.id === s.id) {
      setSwapFirst(null)
      return
    }
    if (swapFirst.userId === s.userId) {
      setMsg('الموظف نفسه — اختر مناوبة لموظف مختلف')
      return
    }
    setSwapConfirm({ a: swapFirst, b: s })
  }

  async function confirmSwap() {
    if (!swapConfirm) return
    setSwapping(true); setMsg('')
    try {
      const r = await fetch('/api/schedule/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftAId: swapConfirm.a.id, shiftBId: swapConfirm.b.id }),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error)
      setMsg(d.message || 'تم التبديل')
      exitSwap()
      load()
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
      setSwapConfirm(null)
    } finally {
      setSwapping(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">جدول المناوبات</h1>
          <p className="text-sm text-gray-500 mt-0.5 font-mono">أسبوع {days[0]} ← {days[6]}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => changeWeek(-1)} className="btn-secondary btn-sm">← الأسبوع السابق</button>
          <button onClick={() => setWeekStart(weekStartStr(new Date()))} className="btn-secondary btn-sm">الأسبوع الحالي</button>
          <button onClick={() => changeWeek(1)} className="btn-secondary btn-sm">الأسبوع التالي →</button>
        </div>
      </div>

      <div className="card p-4 flex items-center gap-3 flex-wrap">
        <span className="text-sm text-gray-600">الحد الأدنى لكل شيفت:</span>
        <input type="number" min={1} max={20} value={minPerShift}
          onChange={e => setMinPerShift(Math.max(1, parseInt(e.target.value) || 1))}
          className="input w-20 py-1 text-sm" />
        <span className="text-sm text-gray-600 ms-2">أيام العطلة الأسبوعية:</span>
        <input type="number" min={0} max={3} value={defaultOffDays}
          onChange={e => setDefaultOffDays(Math.max(0, Math.min(3, parseInt(e.target.value) || 0)))}
          className="input w-20 py-1 text-sm" />
        <span className="text-[11px] text-gray-400">(0–3، يُتجاوز بإعدادات الموظف الفردية)</span>
        <button onClick={handleSuggest} className="btn-secondary btn-sm">
          <Sparkles size={14} /> اقتراح تلقائي
        </button>
        <div className="flex-1" />
        {!swapMode ? (
          <button onClick={() => setSwapMode(true)} className="btn-secondary btn-sm" title="تبديل موظفَين بين مناوبتين">
            <ArrowRightLeft size={14} /> وضع التبديل
          </button>
        ) : (
          <button onClick={exitSwap} className="btn-secondary btn-sm bg-amber-50 text-amber-700 border-amber-200">
            <X size={14} /> إنهاء التبديل
          </button>
        )}
        <button onClick={handleSave} disabled={saving || shifts.length === 0 || swapMode} className="btn-primary btn-sm">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          حفظ ({shifts.length})
        </button>
      </div>

      {swapMode && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-2.5 rounded-lg flex items-center gap-2">
          <ArrowRightLeft size={14} />
          {swapFirst
            ? <>تم اختيار: <strong className="mx-1">{swapFirst.user.name}</strong> — اختر المناوبة المقابلة (لموظف آخر)</>
            : 'اختر المناوبة الأولى من الجدول'}
          {swapFirst && (
            <button onClick={() => setSwapFirst(null)} className="ms-2 text-xs underline">إلغاء الاختيار</button>
          )}
        </div>
      )}

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
                  <th key={i} className="px-2 py-3 text-center font-semibold text-gray-600 min-w-[160px]">
                    <div className="text-xs">{DAY_NAMES[dayOfWeek(d)]}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{d.slice(5)}</div>
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
                  {days.map((dateStr, i) => {
                    const list = getShifts(dateStr, sn)
                    const offCount = list.filter(s => s.isDayOff).length
                    const workingCount = list.length - offCount
                    return (
                      <td key={i} className="px-2 py-2 align-top">
                        <div className="space-y-1.5">
                          {list.map(s => {
                            const isSwapFirst = swapFirst?.id === s.id
                            const inSwapMode = swapMode && !s.isDayOff
                            const isPersisted = !s.id.startsWith('tmp-')
                            return (
                              <div
                                key={s.id}
                                onClick={inSwapMode ? () => pickSwapTarget(s) : undefined}
                                className={`border rounded-lg px-2 py-1 text-xs transition-all ${
                                  s.isDayOff
                                    ? 'bg-gray-100 border-gray-300 opacity-75'
                                    : isSwapFirst
                                    ? 'bg-amber-100 border-amber-400 ring-2 ring-amber-300'
                                    : inSwapMode && isPersisted
                                    ? 'bg-blue-50 border-blue-200 cursor-pointer hover:bg-blue-100 hover:border-blue-300'
                                    : inSwapMode && !isPersisted
                                    ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed'
                                    : 'bg-blue-50 border-blue-200'
                                }`}
                                title={
                                  s.isDayOff
                                    ? 'في إجازة'
                                    : inSwapMode && !isPersisted
                                    ? 'احفظ أولاً ثم بدّل'
                                    : undefined
                                }
                              >
                                <div className="flex items-center gap-1">
                                  <span className={`flex-1 truncate font-medium ${s.isDayOff ? 'line-through text-gray-500' : ''}`}>
                                    {s.user?.name || '?'}
                                  </span>
                                  {s.isDayOff && (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-bold">
                                      إجازة
                                    </span>
                                  )}
                                  {!swapMode && (
                                    <button
                                      onClick={() => remove(s.id)}
                                      className="text-red-500 hover:text-red-700"
                                      title="حذف"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  )}
                                </div>
                                {/* Wallet chips + edit button */}
                                {!s.isDayOff && !swapMode && (
                                  <div className="mt-1 flex items-center gap-1 flex-wrap">
                                    {s.walletIds.length === 0 ? (
                                      <button
                                        onClick={() => setWalletEditing(s)}
                                        className="text-[10px] text-gray-500 hover:text-blue-600 flex items-center gap-1 px-1.5 py-0.5 rounded border border-dashed border-gray-300 hover:border-blue-400"
                                      >
                                        <Wallet size={10} /> اختر محافظ
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => setWalletEditing(s)}
                                        className="text-[10px] bg-emerald-50 text-emerald-700 hover:bg-emerald-100 ring-1 ring-emerald-200 flex items-center gap-1 px-1.5 py-0.5 rounded"
                                        title={s.walletIds.map(id => accountById.get(id)?.name).filter(Boolean).join(' · ')}
                                      >
                                        <Wallet size={10} /> {s.walletIds.length} محفظة
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          {!swapMode && (
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
                          )}
                          {list.length > 0 && (
                            <div className="text-[9px] text-gray-400 text-center mt-1 font-medium">
                              عاملون: {workingCount} · إجازة: {offCount}
                            </div>
                          )}
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

      {/* Wallet picker modal */}
      {walletEditing && (
        <WalletPickerModal
          shift={walletEditing}
          accounts={accounts}
          onClose={() => setWalletEditing(null)}
          onSave={(walletIds) => {
            updateWallets(walletEditing.id, walletIds)
            setWalletEditing(null)
          }}
        />
      )}

      {/* Swap confirmation modal */}
      {swapConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => !swapping && setSwapConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <ArrowRightLeft size={16} /> تأكيد التبديل
              </h3>
              <button onClick={() => !swapping && setSwapConfirm(null)} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <p className="text-gray-600">سيتم تبديل المناوبتين التاليتين:</p>
              <div className="grid grid-cols-1 gap-2">
                <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
                  <p className="font-medium text-gray-800">{swapConfirm.a.user.name}</p>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">
                    {swapConfirm.a.date.slice(0, 10)} · شيفت {swapConfirm.a.shiftNumber === 'ONE' ? 'أول' : swapConfirm.a.shiftNumber === 'TWO' ? 'ثاني' : 'ثالث'}
                  </p>
                </div>
                <div className="text-center text-gray-400 text-xs">↕ تبديل</div>
                <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
                  <p className="font-medium text-gray-800">{swapConfirm.b.user.name}</p>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">
                    {swapConfirm.b.date.slice(0, 10)} · شيفت {swapConfirm.b.shiftNumber === 'ONE' ? 'أول' : swapConfirm.b.shiftNumber === 'TWO' ? 'ثاني' : 'ثالث'}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-gray-500">
                * المحافظ تبقى مع المناوبة (الموظف الجديد يستلم نفس المحافظ المُخطَّطة للنوبة).
              </p>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
              <button onClick={() => setSwapConfirm(null)} disabled={swapping} className="btn-secondary btn-sm">إلغاء</button>
              <button onClick={confirmSwap} disabled={swapping} className="btn-primary btn-sm">
                {swapping ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                تأكيد التبديل
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Wallet picker modal for a single shift cell ──────────────────────────
function WalletPickerModal({
  shift, accounts, onClose, onSave,
}: {
  shift: Shift
  accounts: Account[]
  onClose: () => void
  onSave: (walletIds: string[]) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(shift.walletIds))

  function toggle(id: string) {
    setSelected(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Wallet size={16} className="text-emerald-600" /> محافظ المناوبة
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {shift.user.name} · {shift.date.slice(0, 10)} · شيفت {shift.shiftNumber === 'ONE' ? 'أول' : shift.shiftNumber === 'TWO' ? 'ثاني' : 'ثالث'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">
          {accounts.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">لا توجد حسابات مُفعَّلة</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {accounts.map(a => {
                const active = selected.has(a.id)
                return (
                  <label key={a.id} className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${
                    active ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200' : 'border-gray-200 hover:border-emerald-200 hover:bg-emerald-50/30'
                  }`}>
                    <input type="checkbox" checked={active} onChange={() => toggle(a.id)} className="rounded border-gray-300" />
                    <Wallet size={13} className={active ? 'text-emerald-600' : 'text-gray-400'} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{a.name}</p>
                      <p className="text-[10px] text-gray-400">{a.currency}</p>
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-500">{selected.size} محفظة مختارة</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-secondary btn-sm">إلغاء</button>
            <button onClick={() => onSave(Array.from(selected))} className="btn-primary btn-sm">
              <Check size={13} /> حفظ في الجدول
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
