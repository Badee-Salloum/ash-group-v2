'use client'
import { useState } from 'react'
import { X, Save, Loader2, MinusCircle } from 'lucide-react'

export interface DeductionEmployee {
  id: string
  name: string
  employeeCode?: string | null
  // Optional — enables the "نسبة من الراتب" toggle on the modal. When
  // missing the toggle is disabled.
  baseSalary?: number | null
}

interface Props {
  employees: DeductionEmployee[]
  defaultUserId?: string
  defaultWeekStart?: string  // YYYY-MM-DD; defaults to current week's Sunday
  onClose: () => void
  onSaved: () => void
}

// Quick-deduction modal — adds an amount to the deductions field of the
// employee's PayrollEntry for the chosen week. Reusable from /payroll
// (defaultUserId unset) and /compensation/[id] (defaultUserId pinned).
//
// Flow:
//   1) POST /api/payroll to ensure the week's entries are materialised.
//   2) GET /api/payroll?weekStart=... to find the target entry id.
//   3) PATCH /api/payroll { id, deductions: existing + delta }.
// This avoids inventing a new endpoint while supporting both first-time
// and incremental deductions.
export function AddDeductionModal({
  employees, defaultUserId, defaultWeekStart, onClose, onSaved,
}: Props) {
  const [userId, setUserId] = useState(defaultUserId || '')
  const [mode, setMode] = useState<'amount' | 'percent'>('amount')
  const [amount, setAmount] = useState('')
  const [percent, setPercent] = useState('')
  const [reason, setReason] = useState('')
  const [weekStart, setWeekStart] = useState(defaultWeekStart || currentSundayStr())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Selected employee's salary — drives the percent → amount conversion.
  const selectedEmp = employees.find(e => e.id === userId)
  const salary = selectedEmp?.baseSalary ?? null
  const percentDisabled = salary == null || salary <= 0
  const computedFromPercent = mode === 'percent' && salary && percent
    ? Math.round((salary * parseFloat(percent)) / 100)
    : null

  async function save() {
    if (!userId) return
    let delta: number
    if (mode === 'percent') {
      if (!salary) { setError('الموظف بدون راتب أساس — تعذّر حساب النسبة'); return }
      const p = parseFloat(percent)
      if (!Number.isFinite(p) || p <= 0 || p > 100) { setError('أدخل نسبة بين 0 و 100'); return }
      delta = Math.round((salary * p) / 100)
    } else {
      if (!amount) return
      delta = parseFloat(amount)
      if (!Number.isFinite(delta) || delta <= 0) {
        setError('أدخل مبلغاً موجباً')
        return
      }
    }
    setSaving(true); setError('')
    try {
      // 1) Make sure entries for that week exist (idempotent — generates
      //    or refreshes the live snapshot).
      await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart }),
      })
      // 2) Find the entry for this user/week.
      const listRes = await fetch(`/api/payroll?weekStart=${weekStart}`)
      const list = await listRes.json()
      if (!list.success) throw new Error(list.error || 'تعذّر جلب الرواتب')
      type Row = {
        id: string; userId: string; deductions: number; status: string
        notes: string | null
      }
      const entry = (list.data as Row[]).find(e => e.userId === userId)
      if (!entry) {
        throw new Error('لم يُعثر على راتب لهذا الأسبوع')
      }
      if (entry.status === 'PAID') {
        throw new Error('راتب هذا الأسبوع مدفوع — لا يمكن إضافة خصومات')
      }
      // 3) Patch with new deductions = existing + delta. Append the reason
      //    to notes so the trail is captured (the audit logger records the
      //    diff but the user-facing notes need narrative context).
      const newDeductions = Number(entry.deductions || 0) + delta
      const tag = mode === 'percent'
        ? `[خصم ${percent}% = ${delta.toLocaleString('en')} ل.س]`
        : `[خصم +${delta.toLocaleString('en')} ل.س]`
      const newNotes = reason
        ? `${entry.notes ? entry.notes + '\n' : ''}${tag} ${reason}`
        : (reason === '' && mode === 'percent'
            ? `${entry.notes ? entry.notes + '\n' : ''}${tag}`
            : entry.notes)
      const r = await fetch('/api/payroll', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, deductions: newDeductions, notes: newNotes }),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error || 'تعذّر الحفظ')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold flex items-center gap-2"><MinusCircle size={18} /> خصم سريع</h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">الموظف *</label>
            <select className="input" value={userId} onChange={e => setUserId(e.target.value)}
              disabled={!!defaultUserId}>
              <option value="">— اختر موظفاً —</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.name}{e.employeeCode ? ` (${e.employeeCode})` : ''}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMode('amount')}
                className={`px-3 py-1 rounded-md transition-colors ${
                  mode === 'amount' ? 'bg-white shadow font-semibold' : 'text-gray-600'
                }`}
              >
                مبلغ ثابت
              </button>
              <button
                type="button"
                onClick={() => !percentDisabled && setMode('percent')}
                disabled={percentDisabled}
                title={percentDisabled ? 'الموظف بدون راتب أساس — لا يمكن استخدام النسبة' : ''}
                className={`px-3 py-1 rounded-md transition-colors ${
                  mode === 'percent' ? 'bg-white shadow font-semibold' : 'text-gray-600'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                نسبة من الراتب
              </button>
            </div>
            {mode === 'amount' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">المبلغ (ل.س) *</label>
                <input type="number" step="1000" className="input font-mono" value={amount}
                  onChange={e => setAmount(e.target.value)} />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">النسبة (%) *</label>
                <input type="number" step="0.5" min="0" max="100" className="input font-mono" value={percent}
                  onChange={e => setPercent(e.target.value)} placeholder="5" />
                {salary && (
                  <p className="text-[11px] text-gray-500 mt-1">
                    الراتب الأساس: <span className="font-mono">{salary.toLocaleString('en')}</span> ل.س
                    {computedFromPercent != null && (
                      <> · = <span className="font-mono font-semibold text-rose-700">{computedFromPercent.toLocaleString('en')}</span> ل.س</>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">الأسبوع *</label>
            <input type="date" className="input" value={weekStart}
              onChange={e => setWeekStart(e.target.value)} />
            <p className="text-[11px] text-gray-400 mt-1">الأحد الذي يبدأ به الأسبوع.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">السبب (اختياري)</label>
            <input className="input" value={reason} onChange={e => setReason(e.target.value)}
              placeholder="مثلاً: تأخّر، غياب، ضرر…" />
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <button
            onClick={save}
            disabled={saving || !userId || (mode === 'amount' ? !amount : !percent)}
            className="btn-primary w-full justify-center"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            إضافة الخصم
          </button>
        </div>
      </div>
    </div>
  )
}

function currentSundayStr(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().slice(0, 10)
}
