'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { Save, Loader2, Sparkles, Trash2, X, Wallet, Check, Copy, ClipboardPaste, ArrowRightLeft } from 'lucide-react'
import { weekStartStr, weekDays, addDays, dayOfWeek } from '@/lib/datetime'
import { previousShift, previousShiftIsPriorDay } from '@/lib/shifts/shiftWindow'
import { suggestHandover } from '@/lib/schedule/handoverSuggest'

type ShiftNum = 'ONE' | 'TWO' | 'THREE'

interface Shift {
  id: string
  date: string
  shiftNumber: ShiftNum
  userId: string
  user: { id: string; name: string; jobTitle: string | null; avatarUrl: string | null }
  isDayOff: boolean
  walletIds: string[]
  handoverFromUserIds: string[]
}

interface Employee { id: string; name: string; jobTitle?: string | null; avatarUrl?: string | null }
interface Account { id: string; name: string; currency: string; isActive?: boolean }

type Clipboard =
  | { kind: 'cell'; shifts: Shift[] }
  | { kind: 'day'; shifts: Shift[] }
  | { kind: 'week'; shifts: Shift[] }
  | null

function toShiftUser(e?: Employee): Shift['user'] {
  return {
    id: e?.id || '',
    name: e?.name || '',
    jobTitle: e?.jobTitle ?? null,
    avatarUrl: e?.avatarUrl ?? null,
  }
}

let idSeq = 0
function newTmpId(): string {
  return `tmp-${Date.now()}-${idSeq++}-${Math.random().toString(36).slice(2, 6)}`
}

const SHIFT_LABEL: Record<ShiftNum, { label: string; cls: string }> = {
  ONE:   { label: '06:00 → 14:00', cls: 'bg-amber-50 border-amber-200' },
  TWO:   { label: '14:00 → 22:00', cls: 'bg-sky-50 border-sky-200' },
  THREE: { label: '22:00 → 06:00', cls: 'bg-indigo-50 border-indigo-200' },
}
const SHIFT_AR: Record<ShiftNum, string> = { ONE: 'أول', TWO: 'ثاني', THREE: 'ثالث' }
const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

export default function SchedulePage() {
  // weekStart is always a YYYY-MM-DD Sunday string (Damascus calendar).
  const [weekStart, setWeekStart] = useState(() => weekStartStr(new Date()))
  const [shifts, setShifts] = useState<Shift[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [minPerShift, setMinPerShift] = useState(1)
  const [defaultOffDays, setDefaultOffDays] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const [walletEditing, setWalletEditing] = useState<Shift | null>(null)
  const [handoverEditing, setHandoverEditing] = useState<Shift | null>(null)
  // Copy/paste clipboard — captures a cell, a whole day, or the whole week.
  const [clipboard, setClipboard] = useState<Clipboard>(null)

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
    if (s.success) setShifts((s.data as Shift[]).map(x => ({
      ...x,
      walletIds: x.walletIds || [],
      handoverFromUserIds: x.handoverFromUserIds || [],
    })))
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
  const employeeById = useMemo(() => {
    const m = new Map<string, Employee>()
    for (const e of employees) m.set(e.id, e)
    return m
  }, [employees])

  function getShifts(dateStr: string, sn: ShiftNum) {
    return shifts.filter(s => s.date.slice(0, 10) === dateStr && s.shiftNumber === sn)
  }

  // The (date, shift) cell that runs immediately before (dateStr, sn).
  function prevCellOf(dateStr: string, sn: ShiftNum): { date: string; sn: ShiftNum } {
    return {
      date: previousShiftIsPriorDay(sn) ? addDays(dateStr, -1) : dateStr,
      sn: previousShift(sn),
    }
  }

  function assign(dateStr: string, sn: ShiftNum, userId: string) {
    if (!userId) return
    setShifts(prev => [
      ...prev,
      {
        id: newTmpId(),
        date: dateStr,
        shiftNumber: sn,
        userId,
        user: toShiftUser(employeeById.get(userId)),
        isDayOff: false,
        walletIds: [],
        handoverFromUserIds: [],
      },
    ])
  }

  function remove(shiftId: string) {
    setShifts(prev => prev.filter(s => s.id !== shiftId))
  }

  function updateWallets(shiftId: string, walletIds: string[]) {
    setShifts(prev => prev.map(s => s.id === shiftId ? { ...s, walletIds } : s))
  }

  function updateHandover(shiftId: string, handoverFromUserIds: string[]) {
    setShifts(prev => prev.map(s => s.id === shiftId ? { ...s, handoverFromUserIds } : s))
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
      const tmp: Shift[] = d.data.map((s: {
        date: string; shiftNumber: ShiftNum; userId: string; isDayOff: boolean
        handoverFromUserIds?: string[]
      }) => ({
        id: newTmpId(),
        date: s.date,
        shiftNumber: s.shiftNumber,
        userId: s.userId,
        user: toShiftUser(employeeById.get(s.userId)),
        isDayOff: s.isDayOff,
        walletIds: [],
        handoverFromUserIds: s.handoverFromUserIds || [],
      }))
      setShifts(tmp)
    }
    setLoading(false)
  }

  // Recompute every cell's handover sets from the wallets currently assigned
  // in the grid (wallet-overlap pairing). Falls back to index pairing for
  // cells with no wallets.
  function handleSuggestHandover() {
    setShifts(prev => {
      const updated = prev.map(s => ({ ...s, handoverFromUserIds: [...s.handoverFromUserIds] }))
      const byCell = new Map<string, Shift[]>()
      for (const s of updated) {
        if (s.isDayOff) continue
        const k = `${s.date.slice(0, 10)}|${s.shiftNumber}`
        const arr = byCell.get(k)
        if (arr) arr.push(s)
        else byCell.set(k, [s])
      }
      for (const [k, members] of byCell) {
        const [date, sn] = k.split('|') as [string, ShiftNum]
        const pc = prevCellOf(date, sn)
        const prevMembers = byCell.get(`${pc.date}|${pc.sn}`) ?? []
        const suggestion = suggestHandover(
          members.map(m => ({ userId: m.userId, walletIds: m.walletIds })),
          prevMembers.map(m => ({ userId: m.userId, walletIds: m.walletIds })),
        )
        for (const m of members) m.handoverFromUserIds = suggestion[m.userId] || []
      }
      return updated
    })
    setMsg('تم اقتراح التسليم حسب المحافظ')
  }

  // ── Copy / paste ──────────────────────────────────────────────────────────
  function cloneInto(src: Shift[], remap: (s: Shift) => { date: string; shiftNumber: ShiftNum }): Shift[] {
    return src.map(s => {
      const { date, shiftNumber } = remap(s)
      return {
        ...s,
        id: newTmpId(),
        date,
        shiftNumber,
        walletIds: [...s.walletIds],
        handoverFromUserIds: [...s.handoverFromUserIds],
      }
    })
  }

  function copyCell(dateStr: string, sn: ShiftNum) {
    setClipboard({ kind: 'cell', shifts: getShifts(dateStr, sn) })
    setMsg(`نُسخت خلية (${getShifts(dateStr, sn).length} موظف)`)
  }
  function copyDay(dateStr: string) {
    const dayShifts = shifts.filter(s => s.date.slice(0, 10) === dateStr)
    setClipboard({ kind: 'day', shifts: dayShifts })
    setMsg(`نُسخ يوم كامل (${dayShifts.length} موظف)`)
  }
  function copyWeek() {
    setClipboard({ kind: 'week', shifts })
    setMsg(`نُسخ الأسبوع (${shifts.length} موظف)`)
  }

  function pasteCell(dateStr: string, sn: ShiftNum) {
    if (clipboard?.kind !== 'cell') return
    const cloned = cloneInto(clipboard.shifts, () => ({ date: dateStr, shiftNumber: sn }))
    setShifts(prev => [
      ...prev.filter(s => !(s.date.slice(0, 10) === dateStr && s.shiftNumber === sn)),
      ...cloned,
    ])
    setMsg('لُصقت الخلية')
  }
  function pasteDay(dateStr: string) {
    if (clipboard?.kind !== 'day') return
    const cloned = cloneInto(clipboard.shifts, s => ({ date: dateStr, shiftNumber: s.shiftNumber }))
    setShifts(prev => [
      ...prev.filter(s => s.date.slice(0, 10) !== dateStr),
      ...cloned,
    ])
    setMsg('لُصق اليوم')
  }
  function pasteWeek() {
    if (clipboard?.kind !== 'week') return
    // Map each clipboard shift onto the displayed week by its day-of-week index.
    const srcDays = Array.from(new Set(clipboard.shifts.map(s => s.date.slice(0, 10)))).sort()
    const dayIndexOf = new Map(srcDays.map((d, i) => [d, i]))
    const cloned = cloneInto(clipboard.shifts, s => {
      const idx = dayIndexOf.get(s.date.slice(0, 10)) ?? 0
      return { date: days[Math.min(idx, 6)], shiftNumber: s.shiftNumber }
    })
    setShifts(cloned)
    setMsg('لُصق الأسبوع على الأسبوع الحالي')
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
          handoverFromUserIds: s.handoverFromUserIds,
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

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">جدول المناوبات</h1>
          <p className="text-sm text-gray-500 mt-0.5 font-mono">أسبوع {days[0]} ← {days[6]}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
        <button onClick={handleSuggest} className="btn-secondary btn-sm">
          <Sparkles size={14} /> اقتراح تلقائي
        </button>
        <button onClick={handleSuggestHandover} className="btn-secondary btn-sm" title="يُعيد ربط كل موظف بالموظف السابق حسب تطابق المحافظ">
          <ArrowRightLeft size={14} /> اقتراح التسليم حسب المحافظ
        </button>
        <button onClick={copyWeek} className="btn-secondary btn-sm">
          <Copy size={14} /> نسخ الأسبوع
        </button>
        {clipboard?.kind === 'week' && (
          <button onClick={pasteWeek} className="btn-secondary btn-sm text-blue-700">
            <ClipboardPaste size={14} /> لصق الأسبوع
          </button>
        )}
        <div className="flex-1" />
        <button onClick={handleSave} disabled={saving || shifts.length === 0} className="btn-primary btn-sm">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          حفظ ({shifts.length})
        </button>
      </div>

      {clipboard && (
        <div className="text-[11px] text-blue-700 bg-blue-50 rounded-lg px-3 py-1.5 inline-flex items-center gap-1">
          <ClipboardPaste size={12} />
          الحافظة: {clipboard.kind === 'cell' ? 'خلية' : clipboard.kind === 'day' ? 'يوم كامل' : 'أسبوع كامل'} ({clipboard.shifts.length} موظف)
          <button onClick={() => setClipboard(null)} className="ms-1 text-blue-400 hover:text-blue-600"><X size={12} /></button>
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
        <>
        <p className="sm:hidden text-[11px] text-gray-400 text-center">← اسحب أفقياً لعرض بقية الأيام →</p>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-3 text-right font-semibold text-gray-600 w-32">المناوبة</th>
                {days.map((d, i) => (
                  <th key={i} className="px-2 py-3 text-center font-semibold text-gray-600 min-w-[170px]">
                    <div className="text-xs">{DAY_NAMES[dayOfWeek(d)]}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{d.slice(5)}</div>
                    <div className="flex items-center justify-center gap-1 mt-1">
                      <button onClick={() => copyDay(d)} className="text-gray-400 hover:text-blue-600" title="نسخ اليوم">
                        <Copy size={11} />
                      </button>
                      {clipboard?.kind === 'day' && (
                        <button onClick={() => pasteDay(d)} className="text-blue-500 hover:text-blue-700" title="لصق اليوم">
                          <ClipboardPaste size={11} />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['ONE', 'TWO', 'THREE'] as const).map(sn => (
                <tr key={sn} className="border-b border-gray-100">
                  <td className={`px-3 py-3 align-top ${SHIFT_LABEL[sn].cls} border-r-4 sticky right-0 z-10`}>
                    <div className="text-sm font-bold text-gray-700">شيفت {SHIFT_AR[sn]}</div>
                    <div className="text-[10px] text-gray-500 font-mono">{SHIFT_LABEL[sn].label}</div>
                  </td>
                  {days.map((dateStr, i) => {
                    const list = getShifts(dateStr, sn)
                    const offCount = list.filter(s => s.isDayOff).length
                    const workingCount = list.length - offCount
                    const pc = prevCellOf(dateStr, sn)
                    const prevWorking = shifts.filter(
                      s => s.date.slice(0, 10) === pc.date && s.shiftNumber === pc.sn && !s.isDayOff,
                    )
                    return (
                      <td key={i} className="px-2 py-2 align-top">
                        <div className="flex items-center justify-end gap-1 mb-1">
                          <button onClick={() => copyCell(dateStr, sn)} className="text-gray-300 hover:text-blue-600" title="نسخ الخلية">
                            <Copy size={11} />
                          </button>
                          {clipboard?.kind === 'cell' && (
                            <button onClick={() => pasteCell(dateStr, sn)} className="text-blue-400 hover:text-blue-700" title="لصق الخلية">
                              <ClipboardPaste size={11} />
                            </button>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {list.map(s => (
                            <div
                              key={s.id}
                              className={`border rounded-lg px-2 py-1 text-xs ${
                                s.isDayOff
                                  ? 'bg-gray-100 border-gray-300 opacity-75'
                                  : 'bg-blue-50 border-blue-200'
                              }`}
                            >
                              <div className="flex items-center gap-1">
                                <span className={`flex-1 truncate font-medium ${s.isDayOff ? 'line-through text-gray-500' : ''}`}>
                                  {s.user?.name || employeeById.get(s.userId)?.name || '?'}
                                </span>
                                {s.isDayOff && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-bold">
                                    إجازة
                                  </span>
                                )}
                                <button onClick={() => remove(s.id)} className="text-red-500 hover:text-red-700" title="حذف">
                                  <Trash2 size={11} />
                                </button>
                              </div>
                              {!s.isDayOff && (
                                <div className="mt-1 flex items-center gap-1 flex-wrap">
                                  {/* Wallets */}
                                  <button
                                    onClick={() => setWalletEditing(s)}
                                    className={`text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded ${
                                      s.walletIds.length === 0
                                        ? 'text-gray-500 hover:text-blue-600 border border-dashed border-gray-300'
                                        : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                                    }`}
                                    title={s.walletIds.map(id => accountById.get(id)?.name).filter(Boolean).join(' · ')}
                                  >
                                    <Wallet size={10} />
                                    {s.walletIds.length === 0 ? 'محافظ' : `${s.walletIds.length} محفظة`}
                                  </button>
                                  {/* Handover */}
                                  <button
                                    onClick={() => setHandoverEditing(s)}
                                    className={`text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded ${
                                      s.handoverFromUserIds.length === 0
                                        ? 'text-gray-500 hover:text-blue-600 border border-dashed border-gray-300'
                                        : 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
                                    }`}
                                    title={s.handoverFromUserIds
                                      .map(id => employeeById.get(id)?.name)
                                      .filter(Boolean).join(' · ')}
                                  >
                                    <ArrowRightLeft size={10} />
                                    {s.handoverFromUserIds.length === 0
                                      ? 'تسليم من'
                                      : `تسليم: ${s.handoverFromUserIds.length}`}
                                  </button>
                                </div>
                              )}
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
                          {list.length > 0 && (
                            <div className="text-[9px] text-gray-400 text-center mt-1 font-medium">
                              عاملون: {workingCount} · إجازة: {offCount}
                              {prevWorking.length === 0 && sn !== 'ONE' && (
                                <span className="text-amber-500"> · لا شيفت سابق</span>
                              )}
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
        </>
      )}

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

      {handoverEditing && (
        <HandoverPickerModal
          shift={handoverEditing}
          previousShiftEmployees={(() => {
            const pc = prevCellOf(handoverEditing.date.slice(0, 10), handoverEditing.shiftNumber)
            return shifts
              .filter(s => s.date.slice(0, 10) === pc.date && s.shiftNumber === pc.sn && !s.isDayOff)
              .map(s => ({ id: s.userId, name: s.user?.name || employeeById.get(s.userId)?.name || '?' }))
          })()}
          onClose={() => setHandoverEditing(null)}
          onSave={(ids) => {
            updateHandover(handoverEditing.id, ids)
            setHandoverEditing(null)
          }}
        />
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
              {shift.user.name} · {shift.date.slice(0, 10)} · شيفت {SHIFT_AR[shift.shiftNumber]}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
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
                    active ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200' : 'border-gray-200 hover:border-emerald-200'
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

// ─── Handover picker — pick previous-shift employee(s) this person takes over from ──
function HandoverPickerModal({
  shift, previousShiftEmployees, onClose, onSave,
}: {
  shift: Shift
  previousShiftEmployees: Array<{ id: string; name: string }>
  onClose: () => void
  onSave: (userIds: string[]) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(shift.handoverFromUserIds))

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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <ArrowRightLeft size={16} className="text-violet-600" /> التسليم من الشيفت السابق
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {shift.user.name} · شيفت {SHIFT_AR[shift.shiftNumber]} — لن يُقبل دخوله إلا بعد أن يطلب كل من اخترتهم تسجيل خروج
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 overflow-y-auto">
          {previousShiftEmployees.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">
              لا يوجد موظفون مجدولون في الشيفت السابق لهذا اليوم.
            </p>
          ) : (
            <div className="space-y-2">
              {previousShiftEmployees.map(e => {
                const active = selected.has(e.id)
                return (
                  <label key={e.id} className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer ${
                    active ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-200' : 'border-gray-200 hover:border-violet-200'
                  }`}>
                    <input type="checkbox" checked={active} onChange={() => toggle(e.id)} className="rounded border-gray-300" />
                    <span className="text-sm font-medium text-gray-800">{e.name}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-500">{selected.size} موظف</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-secondary btn-sm">إلغاء</button>
            <button onClick={() => onSave(Array.from(selected))} className="btn-primary btn-sm">
              <Check size={13} /> حفظ
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
