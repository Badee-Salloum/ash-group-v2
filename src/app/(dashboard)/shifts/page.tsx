'use client'
import { useEffect, useState, useCallback } from 'react'
import { fmtSyria } from '@/lib/datetime'
import { Clock, Check, X, ArrowRightLeft, Loader2, LogIn, LogOut } from 'lucide-react'

interface Account { id: string; name: string; currency: string }
interface Employee { id: string; name: string; jobTitle: string | null }
interface Sess {
  id: string
  userId: string
  user: { id: string; name: string; jobTitle: string | null; employeeCode: string | null; avatarUrl: string | null }
  shiftNumber: 'ONE' | 'TWO' | 'THREE' | null
  startAt: string
  endAt: string | null
  durationMinutes: number | null
  status: 'ACTIVE' | 'PENDING_END' | 'PENDING_START' | 'COMPLETED' | 'CANCELLED'
  handoverFromUserId: string | null
  approvedBy: { id: string; name: string } | null
  wallets: Array<{ accountId: string }>
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'نشطة', cls: 'bg-emerald-100 text-emerald-800' },
  PENDING_END: { label: 'بانتظار الإغلاق', cls: 'bg-amber-100 text-amber-800' },
  PENDING_START: { label: 'بانتظار الموافقة', cls: 'bg-blue-100 text-blue-800' },
  COMPLETED: { label: 'مكتملة', cls: 'bg-gray-100 text-gray-700' },
  CANCELLED: { label: 'ملغاة', cls: 'bg-rose-100 text-rose-700' },
}

const SHIFT_LABEL: Record<string, string> = {
  ONE: 'الأولى (06:00–14:00)',
  TWO: 'الثانية (14:00–22:00)',
  THREE: 'الثالثة (22:00–06:00)',
}

export default function ShiftsPage() {
  const [mySessions, setMySessions] = useState<Sess[]>([])
  const [allActive, setAllActive] = useState<Sess[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<Sess[]>([])
  const [allowedWallets, setAllowedWallets] = useState<Account[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [showCheckIn, setShowCheckIn] = useState(false)
  const [shiftNumber, setShiftNumber] = useState<'ONE' | 'TWO' | 'THREE' | ''>('')
  const [walletIds, setWalletIds] = useState<Set<string>>(new Set())
  const [handoverFrom, setHandoverFrom] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [me, all, emps] = await Promise.all([
      fetch('/api/shifts/sessions?userId=me').then(r => r.json()),
      fetch('/api/shifts/sessions').then(r => r.json()),
      fetch('/api/employees').then(r => r.json()),
    ])
    if (me.success) setMySessions(me.data)
    if (all.success) {
      const data: Sess[] = all.data
      setAllActive(data.filter(s => s.status === 'ACTIVE' || s.status === 'PENDING_END'))
      setPendingApprovals(data.filter(s => s.status === 'PENDING_START'))
    }
    if (emps.success) setEmployees(emps.data || [])
    // load my wallet assignments
    const meRes = await fetch('/api/me').catch(() => null)
    const meData = meRes ? await meRes.json().catch(() => ({})) : {}
    const myUserId = meData?.id
    if (myUserId) {
      const w = await fetch(`/api/employees/${myUserId}/wallets`).then(r => r.json()).catch(() => ({ data: [] }))
      if (w.success) {
        setAllowedWallets((w.data as Array<{ account: Account }>).map(x => x.account))
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const myActive = mySessions.find(s => s.status === 'ACTIVE' || s.status === 'PENDING_END')

  function toggleWallet(id: string) {
    setWalletIds(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  async function handleCheckIn() {
    setSubmitting(true); setMsg('')
    try {
      const res = await fetch('/api/shifts/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shiftNumber: shiftNumber || undefined,
          walletIds: Array.from(walletIds),
          handoverFromUserId: handoverFrom || undefined,
          notes: notes || undefined,
        }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setShowCheckIn(false)
      setShiftNumber(''); setWalletIds(new Set()); setHandoverFrom(''); setNotes('')
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleAction(sessionId: string, action: 'requestEnd' | 'approveHandover' | 'cancel') {
    if (action === 'cancel' && !confirm('إلغاء الجلسة؟')) return
    try {
      const res = await fetch('/api/shifts/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, sessionId }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      load()
    } catch (e) {
      alert('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center p-20 text-gray-400 gap-2">
      <Loader2 size={20} className="animate-spin" /> جاري التحميل...
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">المناوبات</h1>
          <p className="text-sm text-gray-500 mt-0.5">تسجيل الدخول والخروج وتسليم الجلسات</p>
        </div>
        {!myActive && !showCheckIn && (
          <button onClick={() => setShowCheckIn(true)} className="btn-primary">
            <LogIn size={16} /> تسجيل دخول
          </button>
        )}
      </div>

      {/* My active session */}
      {myActive && (
        <div className="card p-5 border-r-4 border-emerald-500">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs text-gray-400 uppercase font-bold mb-1">جلستي الحالية</p>
              <p className="text-lg font-bold text-gray-900">
                {STATUS_LABEL[myActive.status].label}
                {myActive.shiftNumber && <span className="text-sm font-normal text-gray-500"> — {SHIFT_LABEL[myActive.shiftNumber]}</span>}
              </p>
              <p className="text-xs text-gray-500 mt-1 font-mono">
                بدأت: {fmtSyria(myActive.startAt)} · {myActive.wallets.length} محفظة
              </p>
            </div>
            <div className="flex items-center gap-2">
              {myActive.status === 'ACTIVE' && (
                <button onClick={() => handleAction(myActive.id, 'requestEnd')} className="btn-secondary">
                  <LogOut size={14} /> طلب تسجيل خروج
                </button>
              )}
              {myActive.status === 'PENDING_END' && (
                <span className="text-xs text-amber-700 bg-amber-50 px-3 py-1 rounded-lg">
                  بانتظار وصول الموظف التالي وموافقة المشرف
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pending approvals (Manager view) */}
      {pendingApprovals.length > 0 && (
        <div className="card p-4">
          <h2 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
            <ArrowRightLeft size={16} className="text-blue-500" />
            موافقات تبديل المناوبات المعلقة ({pendingApprovals.length})
          </h2>
          <div className="space-y-2">
            {pendingApprovals.map(s => (
              <div key={s.id} className="border border-blue-200 bg-blue-50/30 rounded-xl p-3 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
                    {s.user.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{s.user.name}</p>
                    <p className="text-xs text-gray-500">
                      يطلب بدء مناوبة · {s.wallets.length} محفظة · {fmtSyria(s.startAt, false)}
                    </p>
                  </div>
                </div>
                <button onClick={() => handleAction(s.id, 'approveHandover')} className="btn-primary btn-sm">
                  <Check size={13} /> اعتماد التبديل
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active sessions across all employees */}
      <div className="card p-4">
        <h2 className="font-bold text-gray-800 mb-3">الجلسات النشطة ({allActive.length})</h2>
        {allActive.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">لا توجد جلسات نشطة الآن</p>
        ) : (
          <div className="space-y-2">
            {allActive.map(s => (
              <div key={s.id} className="border border-gray-200 rounded-xl p-3 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  {s.user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.user.avatarUrl} alt={s.user.name} className="w-9 h-9 rounded-full object-cover" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center font-bold text-sm">
                      {s.user.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-sm">{s.user.name}</p>
                    <p className="text-xs text-gray-500 font-mono">{fmtSyria(s.startAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${STATUS_LABEL[s.status].cls}`}>{STATUS_LABEL[s.status].label}</span>
                  <span className="text-xs text-gray-500">{s.wallets.length} محفظة</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Check-in modal */}
      {showCheckIn && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="font-bold text-gray-800 flex items-center gap-2">
                <LogIn size={18} /> تسجيل دخول جلسة
              </h2>
              <button onClick={() => setShowCheckIn(false)} className="btn-ghost p-1.5"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">المناوبة</label>
                <select className="input" value={shiftNumber} onChange={e => setShiftNumber(e.target.value as typeof shiftNumber)}>
                  <option value="">— تلقائي —</option>
                  <option value="ONE">{SHIFT_LABEL.ONE}</option>
                  <option value="TWO">{SHIFT_LABEL.TWO}</option>
                  <option value="THREE">{SHIFT_LABEL.THREE}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">تبديل مع موظف خارج (اختياري)</label>
                <select className="input" value={handoverFrom} onChange={e => setHandoverFrom(e.target.value)}>
                  <option value="">— لا تبديل —</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.name}{e.jobTitle ? ` (${e.jobTitle})` : ''}</option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-1">إن اخترت موظفاً، يجب أن تكون لديه جلسة نشطة. ستحتاج موافقة المشرف.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">المحافظ التي ستعمل عليها</label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {allowedWallets.map(w => (
                    <label key={w.id} className={`flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer ${
                      walletIds.has(w.id) ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}>
                      <input type="checkbox" checked={walletIds.has(w.id)} onChange={() => toggleWallet(w.id)} />
                      <span className="truncate">{w.name}</span>
                      <span className="text-[10px] text-gray-400">{w.currency}</span>
                    </label>
                  ))}
                  {allowedWallets.length === 0 && (
                    <p className="text-gray-400 text-sm col-span-2 text-center py-4">
                      لم يتم تخصيص أي محافظ لك. اطلب من المدير ضبطها.
                    </p>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات (اختياري)</label>
                <textarea className="input min-h-[60px]" value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
              {msg && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{msg}</p>}
              <div className="flex gap-3">
                <button onClick={handleCheckIn} disabled={submitting} className="btn-primary flex-1 justify-center">
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
                  تسجيل دخول
                </button>
                <button onClick={() => setShowCheckIn(false)} className="btn-secondary flex-1 justify-center">إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
