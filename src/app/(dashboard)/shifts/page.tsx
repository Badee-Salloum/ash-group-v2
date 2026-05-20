'use client'
import { useEffect, useState, useCallback } from 'react'
import { fmtSyria } from '@/lib/datetime'
import { Check, X, ArrowRightLeft, Loader2, LogIn, LogOut, Pencil, StopCircle, CalendarClock } from 'lucide-react'
import SessionEditModal, { type SessionLite } from '@/components/forms/SessionEditModal'
import { useToast } from '@/components/ui/Toast'
import { EmptyState } from '@/components/ui/EmptyState'

interface Account { id: string; name: string; currency: string }
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
interface MyShift {
  shiftNumber: 'ONE' | 'TWO' | 'THREE'
  windowLabel: string
  handoverNames: string[]
  checkinOpen: boolean
  opensAt: string | null
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
  const [myRole, setMyRole] = useState<string>('')
  const [mySessions, setMySessions] = useState<Sess[]>([])
  const [myShift, setMyShift] = useState<MyShift | null>(null)
  // Admin-tier only:
  const [allActive, setAllActive] = useState<Sess[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<Sess[]>([])
  const [recent, setRecent] = useState<Sess[]>([])
  const [allowedWallets, setAllowedWallets] = useState<Account[]>([])
  const [editingSession, setEditingSession] = useState<Sess | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState('')
  const [bulkBusy, setBulkBusy] = useState<'approve' | 'reject' | 'forceComplete' | null>(null)
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    const meRes = await fetch('/api/me').catch(() => null)
    const meData = meRes ? await meRes.json().catch(() => ({})) : {}
    const role: string = meData?.role || ''
    setMyRole(role)
    const isEmp = role === 'EMPLOYEE'

    // Everyone gets their own sessions.
    const meSess = await fetch('/api/shifts/sessions?userId=me').then(r => r.json()).catch(() => ({}))
    if (meSess.success) setMySessions(meSess.data)

    if (isEmp) {
      const ms = await fetch('/api/shifts/my-shift').then(r => r.json()).catch(() => ({}))
      setMyShift(ms.success ? ms.scheduled : null)
    } else {
      // Management view — all sessions + accounts (for the edit modal wallets).
      const [all, accRes] = await Promise.all([
        fetch('/api/shifts/sessions').then(r => r.json()).catch(() => ({})),
        fetch('/api/accounts').then(r => r.json()).catch(() => ({})),
      ])
      if (all.success) {
        const data: Sess[] = all.data
        setAllActive(data.filter(s => s.status === 'ACTIVE' || s.status === 'PENDING_END'))
        setPendingApprovals(data.filter(s => s.status === 'PENDING_START'))
        setRecent(data.filter(s => s.status === 'COMPLETED' || s.status === 'CANCELLED').slice(0, 10))
      }
      if (accRes.success) setAllowedWallets(accRes.data || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const isEmployee = myRole === 'EMPLOYEE'
  const isAdminTier = myRole === 'ADMIN' || myRole === 'MANAGER'
  const myOpen = mySessions.find(
    s => s.status === 'ACTIVE' || s.status === 'PENDING_END' || s.status === 'PENDING_START',
  )
  const myRecent = mySessions
    .filter(s => s.status === 'COMPLETED' || s.status === 'CANCELLED')
    .slice(0, 8)

  // One-click check-in — the server derives shift/wallets/handover from the
  // schedule, so the request carries no body.
  async function handleCheckIn() {
    setSubmitting(true); setMsg('')
    try {
      const res = await fetch('/api/shifts/sessions', { method: 'POST' })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      if (d.data?.autoApprovalReason && !d.data.autoApproved) {
        setMsg(d.data.autoApprovalReason)
        toast('تم إرسال طلب الدخول — بانتظار الاعتماد', 'info')
      } else {
        toast('تم تسجيل الدخول')
      }
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
      // Re-sync the card — its check-in window may have closed since load.
      load()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleAction(
    sessionId: string,
    action: 'requestEnd' | 'approveHandover' | 'cancel' | 'forceComplete',
  ) {
    if (action === 'cancel' && !confirm('إلغاء الجلسة؟ ستظهر كـ "ملغاة" في السجلات.')) return
    if (action === 'forceComplete' && !confirm(
      'إنهاء الجلسة يدوياً وتعليمها كمكتملة؟\n\nيُستخدم عند تجاوز انتظار التسليم — مثلاً عندما لا يصل الموظف التالي.',
    )) return
    try {
      const res = await fetch('/api/shifts/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, sessionId }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      const ACTION_DONE: Record<typeof action, string> = {
        requestEnd: 'تم إرسال طلب الخروج',
        approveHandover: 'تم اعتماد التسليم',
        cancel: 'تم إلغاء الجلسة',
        forceComplete: 'تم إنهاء الجلسة',
      }
      toast(ACTION_DONE[action])
      load()
    } catch (e) {
      toast('خطأ: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }

  async function handleBulk(
    action: 'approveHandover' | 'cancel' | 'forceComplete',
    targets: Sess[],
    confirmMsg: string,
    busyKey: 'approve' | 'reject' | 'forceComplete',
  ) {
    if (targets.length === 0) return
    if (!confirm(confirmMsg)) return
    setBulkBusy(busyKey)
    let ok = 0
    const failures: string[] = []
    for (const s of targets) {
      try {
        const res = await fetch('/api/shifts/sessions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, sessionId: s.id }),
        })
        const d = await res.json()
        if (d.success) ok++
        else failures.push(`${s.user.name}: ${d.error || 'فشل'}`)
      } catch (e) {
        failures.push(`${s.user.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setBulkBusy(null)
    await load()
    alert(failures.length > 0
      ? `نجح: ${ok}\nفشل: ${failures.length}\n\n${failures.slice(0, 5).join('\n')}${failures.length > 5 ? '\n…' : ''}`
      : `تم تنفيذ الإجراء على ${ok} جلسة بنجاح`)
  }

  if (loading) return (
    <div className="flex items-center justify-center p-20 text-gray-400 gap-2">
      <Loader2 size={20} className="animate-spin" /> جاري التحميل...
    </div>
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">المناوبات</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {isEmployee ? 'تسجيل دخولك وخروجك' : 'تسجيل الدخول والخروج وتسليم الجلسات'}
        </p>
      </div>

      {/* ── EMPLOYEE: one-click "my shift" card ── */}
      {isEmployee && (
        <div className="card p-5 border-r-4 border-emerald-500">
          {myOpen ? (
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs text-gray-400 uppercase font-bold mb-1">جلستي الحالية</p>
                <p className="text-lg font-bold text-gray-900">
                  {STATUS_LABEL[myOpen.status].label}
                  {myOpen.shiftNumber && (
                    <span className="text-sm font-normal text-gray-500"> — {SHIFT_LABEL[myOpen.shiftNumber]}</span>
                  )}
                </p>
                <p className="text-xs text-gray-500 mt-1 font-mono">
                  بدأت: {fmtSyria(myOpen.startAt)} · {myOpen.wallets.length} محفظة
                </p>
              </div>
              <div>
                {myOpen.status === 'ACTIVE' && (
                  <button onClick={() => handleAction(myOpen.id, 'requestEnd')} className="btn-primary">
                    <LogOut size={16} /> طلب تسجيل خروج
                  </button>
                )}
                {myOpen.status === 'PENDING_END' && (
                  <span className="text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg">
                    طلبت الخروج — بانتظار وصول الموظف التالي
                  </span>
                )}
                {myOpen.status === 'PENDING_START' && (
                  <span className="text-xs text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg">
                    بانتظار اعتماد التسليم
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs text-gray-400 uppercase font-bold mb-1 flex items-center gap-1">
                  <CalendarClock size={12} /> مناوبتي
                </p>
                {myShift ? (
                  <>
                    <p className="text-lg font-bold text-gray-900">
                      شيفت {myShift.shiftNumber === 'ONE' ? 'أول' : myShift.shiftNumber === 'TWO' ? 'ثاني' : 'ثالث'}
                      <span className="text-sm font-normal text-gray-500"> — {myShift.windowLabel}</span>
                    </p>
                    {myShift.handoverNames.length > 0 && (
                      <p className="text-xs text-violet-700 mt-1">
                        التسليم من: {myShift.handoverNames.join('، ')}
                      </p>
                    )}
                    {!myShift.checkinOpen && myShift.opensAt && (
                      <p className="text-xs text-amber-700 mt-1">
                        يفتح تسجيل الدخول الساعة {fmtSyria(myShift.opensAt, false).slice(11)}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-500">لا توجد مناوبة مجدولة لك في هذا الوقت.</p>
                )}
              </div>
              <button
                onClick={handleCheckIn}
                disabled={submitting || !myShift || !myShift.checkinOpen}
                className="btn-primary"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
                تسجيل دخول
              </button>
            </div>
          )}
          {msg && <p className="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg mt-3">{msg}</p>}
        </div>
      )}

      {/* ── EMPLOYEE: own recent sessions ── */}
      {isEmployee && myRecent.length > 0 && (
        <div className="card p-4">
          <h2 className="font-bold text-gray-800 mb-3">جلساتي السابقة</h2>
          <div className="space-y-2">
            {myRecent.map(s => (
              <div key={s.id} className="border border-gray-200 rounded-xl p-3 flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs text-gray-500 font-mono">
                  {fmtSyria(s.startAt, false)} → {s.endAt ? fmtSyria(s.endAt, false) : '?'}
                  {s.durationMinutes != null && (
                    <span className="ms-2 text-gray-400">
                      ({Math.floor(s.durationMinutes / 60)}س {s.durationMinutes % 60}د)
                    </span>
                  )}
                </p>
                <span className={`badge ${STATUS_LABEL[s.status].cls}`}>{STATUS_LABEL[s.status].label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ADMIN / MANAGER / SUPERVISOR: management view ── */}
      {!isEmployee && (
        <>
          {/* Pending approvals */}
          {pendingApprovals.length > 0 && (
            <div className="card p-4">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <h2 className="font-bold text-gray-800 flex items-center gap-2">
                  <ArrowRightLeft size={16} className="text-blue-500" />
                  موافقات تبديل المناوبات المعلقة ({pendingApprovals.length})
                </h2>
                {isAdminTier && pendingApprovals.length > 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleBulk('approveHandover', pendingApprovals,
                        `اعتماد كل التبديلات المعلقة (${pendingApprovals.length})؟`, 'approve')}
                      disabled={bulkBusy !== null}
                      className="btn-primary btn-sm"
                    >
                      {bulkBusy === 'approve' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      اعتماد الكل
                    </button>
                    <button
                      onClick={() => handleBulk('cancel', pendingApprovals,
                        `رفض كل التبديلات المعلقة (${pendingApprovals.length})؟`, 'reject')}
                      disabled={bulkBusy !== null}
                      className="btn-ghost btn-sm text-rose-600 hover:bg-rose-50"
                    >
                      {bulkBusy === 'reject' ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                      رفض الكل
                    </button>
                  </div>
                )}
              </div>
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
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleAction(s.id, 'approveHandover')} className="btn-primary btn-sm">
                        <Check size={13} /> اعتماد التبديل
                      </button>
                      {isAdminTier && (
                        <button
                          onClick={() => handleAction(s.id, 'cancel')}
                          className="btn-ghost btn-sm text-rose-600 hover:bg-rose-50"
                          title="رفض طلب التبديل"
                        >
                          <X size={13} /> رفض
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active sessions */}
          <div className="card p-4">
            {(() => {
              const pendingEndCount = allActive.filter(s => s.status === 'PENDING_END').length
              return (
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <h2 className="font-bold text-gray-800">الجلسات النشطة ({allActive.length})</h2>
                  {isAdminTier && pendingEndCount > 1 && (
                    <button
                      onClick={() => handleBulk('forceComplete',
                        allActive.filter(s => s.status === 'PENDING_END'),
                        `إنهاء كل الجلسات المعلّقة بانتظار الإغلاق (${pendingEndCount})؟`, 'forceComplete')}
                      disabled={bulkBusy !== null}
                      className="btn-secondary btn-sm"
                    >
                      {bulkBusy === 'forceComplete' ? <Loader2 size={13} className="animate-spin" /> : <StopCircle size={13} />}
                      إنهاء كل المعلّقة ({pendingEndCount})
                    </button>
                  )}
                </div>
              )
            })()}
            {allActive.length === 0 ? (
              <EmptyState
                icon={LogIn}
                title="لا توجد جلسات نشطة الآن"
                hint="ستظهر هنا جلسات الموظفين بمجرد تسجيل دخولهم."
              />
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
                      {isAdminTier && (
                        <button
                          onClick={() => handleAction(s.id, 'forceComplete')}
                          className="btn-ghost p-1.5 text-gray-500 hover:text-emerald-600"
                          title="إنهاء يدوياً"
                        >
                          <StopCircle size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => setEditingSession(s)}
                        className="btn-ghost p-1.5 text-gray-500 hover:text-blue-600"
                        title="تعديل الجلسة"
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recently closed */}
          {recent.length > 0 && (
            <div className="card p-4">
              <h2 className="font-bold text-gray-800 mb-3">جلسات مغلقة حديثاً ({recent.length})</h2>
              <div className="space-y-2">
                {recent.map(s => (
                  <div key={s.id} className="border border-gray-200 rounded-xl p-3 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      {s.user.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.user.avatarUrl} alt={s.user.name} className="w-9 h-9 rounded-full object-cover" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-gray-400 to-gray-600 text-white flex items-center justify-center font-bold text-sm">
                          {s.user.name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-sm">{s.user.name}</p>
                        <p className="text-xs text-gray-500 font-mono">
                          {fmtSyria(s.startAt, false)} → {s.endAt ? fmtSyria(s.endAt, false) : '?'}
                          {s.durationMinutes != null && (
                            <span className="ms-2 text-gray-400">
                              ({Math.floor(s.durationMinutes / 60)}س {s.durationMinutes % 60}د)
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`badge ${STATUS_LABEL[s.status].cls}`}>{STATUS_LABEL[s.status].label}</span>
                      <span className="text-xs text-gray-500">{s.wallets.length} محفظة</span>
                      <button
                        onClick={() => setEditingSession(s)}
                        className="btn-ghost p-1.5 text-gray-500 hover:text-blue-600"
                        title="تعديل الجلسة"
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Session edit modal */}
      {editingSession && (
        <SessionEditModal
          session={editingSession as unknown as SessionLite}
          allowedWallets={allowedWallets}
          isAdminTier={['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(myRole)}
          onClose={() => setEditingSession(null)}
          onSaved={() => { setEditingSession(null); load() }}
        />
      )}
    </div>
  )
}
