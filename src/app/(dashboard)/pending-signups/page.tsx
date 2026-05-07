'use client'
import { useEffect, useState, useCallback } from 'react'
import { fmtSyriaDate } from '@/lib/datetime'
import { UserCheck, X, Loader2, Inbox, CheckCircle2 } from 'lucide-react'

interface PendingUser {
  id: string
  name: string
  email: string
  role: string
  createdAt: string
}

const ROLE_OPTIONS = [
  { value: 'EMPLOYEE', label: 'موظف' },
  { value: 'SUPERVISOR', label: 'مشرف' },
  { value: 'ACCOUNT_MGR', label: 'مدير حساب' },
  { value: 'ACCOUNTANT', label: 'محاسب' },
  { value: 'MANAGER', label: 'مدير فرع' },
  { value: 'ADMIN', label: 'مدير عام' },
]

export default function PendingSignupsPage() {
  const [data, setData] = useState<PendingUser[]>([])
  const [loading, setLoading] = useState(true)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await fetch('/api/admin/pending-signups')
      const d = await r.json()
      if (d.success) setData(d.data || [])
      else setError(d.error || 'تعذّر تحميل البيانات')
    } catch {
      setError('تعذّر الاتصال بالخادم')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  async function handleActivate(id: string, role: string, jobTitle: string, employeeCode: string) {
    setBusyId(id)
    setError('')
    try {
      const r = await fetch(`/api/admin/pending-signups/${id}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, jobTitle, employeeCode }),
      })
      const d = await r.json()
      if (!d.success) {
        setError(d.error || 'تعذّر التفعيل')
        return
      }
      setActivatingId(null)
      showToast('تم تفعيل الحساب بنجاح')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject(id: string, name: string) {
    if (!confirm(`هل تريد رفض طلب التسجيل من "${name}" وحذف الحساب؟`)) return
    setBusyId(id)
    setError('')
    try {
      const r = await fetch(`/api/admin/pending-signups/${id}/reject`, { method: 'POST' })
      const d = await r.json()
      if (!d.success) {
        setError(d.error || 'تعذّر الرفض')
        return
      }
      showToast('تم رفض الطلب وحذف الحساب')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-fade-in">
          <CheckCircle2 size={18} /> {toast}
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">طلبات التسجيل</h1>
          <p className="text-slate-500 text-sm mt-1">
            الحسابات التي أنشأها الموظفون وتنتظر تفعيلك
          </p>
        </div>
        <span className="bg-amber-100 text-amber-800 text-sm font-semibold px-3 py-1.5 rounded-full">
          {data.length} طلب
        </span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-xl mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="animate-spin" size={24} />
        </div>
      ) : data.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 py-16 text-center">
          <Inbox size={48} className="mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500">لا توجد طلبات تسجيل معلّقة</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map(u => (
            <PendingCard
              key={u.id}
              user={u}
              isExpanded={activatingId === u.id}
              isBusy={busyId === u.id}
              onExpand={() => setActivatingId(activatingId === u.id ? null : u.id)}
              onActivate={(role, jobTitle, code) => handleActivate(u.id, role, jobTitle, code)}
              onReject={() => handleReject(u.id, u.name)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface PendingCardProps {
  user: PendingUser
  isExpanded: boolean
  isBusy: boolean
  onExpand: () => void
  onActivate: (role: string, jobTitle: string, employeeCode: string) => void
  onReject: () => void
}

function PendingCard({ user, isExpanded, isBusy, onExpand, onActivate, onReject }: PendingCardProps) {
  const [role, setRole] = useState('EMPLOYEE')
  const [jobTitle, setJobTitle] = useState('')
  const [employeeCode, setEmployeeCode] = useState('')

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-slate-800">{user.name}</h3>
          <p className="text-sm text-slate-500 mt-0.5" dir="ltr">{user.email}</p>
          <p className="text-xs text-slate-400 mt-2">
            تاريخ الطلب: {fmtSyriaDate(user.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onExpand}
            disabled={isBusy}
            className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            <UserCheck size={16} />
            تفعيل
          </button>
          <button
            onClick={onReject}
            disabled={isBusy}
            className="px-4 py-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            <X size={16} />
            رفض
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-100 p-5 bg-slate-50 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                الدور <span className="text-red-500">*</span>
              </label>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              >
                {ROLE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                المسمى الوظيفي
              </label>
              <input
                type="text"
                value={jobTitle}
                onChange={e => setJobTitle(e.target.value)}
                placeholder="اختياري"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                maxLength={80}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                الرقم الوظيفي
              </label>
              <input
                type="text"
                value={employeeCode}
                onChange={e => setEmployeeCode(e.target.value)}
                placeholder="اختياري"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                maxLength={40}
                dir="ltr"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => onActivate(role, jobTitle, employeeCode)}
              disabled={isBusy}
              className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
            >
              {isBusy ? <Loader2 className="animate-spin" size={16} /> : <UserCheck size={16} />}
              تأكيد التفعيل
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
