'use client'
import { useState } from 'react'
import { Gift, Award, X, Save, Loader2 } from 'lucide-react'

// Shared bonus-issuing modals — extracted from /bonuses page so both
// /bonuses and /compensation can mount the same UX without duplicating
// state, layout, or submit logic.

export interface BonusEmployee {
  id: string
  name: string
  employeeCode?: string | null
  // Optional — enables the "نسبة من الراتب" toggle. When null/undefined
  // the percent option is disabled with a tooltip.
  baseSalary?: number | null
}

interface GroupBonusModalProps {
  employees: BonusEmployee[]
  initialUserIds?: string[]
  onClose: () => void
  onSaved: () => void
}

export function GroupBonusModal({ employees, initialUserIds = [], onClose, onSaved }: GroupBonusModalProps) {
  const [mode, setMode] = useState<'amount' | 'percent'>('amount')
  const [amount, setAmount] = useState('')
  const [percent, setPercent] = useState('')
  const [reason, setReason] = useState('')
  const [userIds, setUserIds] = useState<Set<string>>(new Set(initialUserIds))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Percent option needs at least ONE selected employee with a baseSalary.
  // We don't disable it eagerly though — server will reject any user
  // without a salary with a clear error.
  const anyHasSalary = employees.some(e => e.baseSalary != null && e.baseSalary > 0)
  const percentDisabled = !anyHasSalary

  async function save() {
    if (userIds.size === 0) return
    if (mode === 'amount' && !amount) return
    if (mode === 'percent' && !percent) return
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/bonuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'GROUP',
          ...(mode === 'percent'
            ? { percent: parseFloat(percent) }
            : { amount: parseFloat(amount) }),
          reason: reason || undefined,
          userIds: Array.from(userIds),
        }),
      })
      const d = await res.json()
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold flex items-center gap-2"><Gift size={18} /> مكافأة جماعية</h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-xs">
            <button type="button" onClick={() => setMode('amount')}
              className={`px-3 py-1 rounded-md ${mode === 'amount' ? 'bg-white shadow font-semibold' : 'text-gray-600'}`}>
              مبلغ ثابت
            </button>
            <button type="button" onClick={() => !percentDisabled && setMode('percent')} disabled={percentDisabled}
              title={percentDisabled ? 'لا يوجد موظف بعمل راتب أساس' : ''}
              className={`px-3 py-1 rounded-md ${mode === 'percent' ? 'bg-white shadow font-semibold' : 'text-gray-600'} disabled:opacity-50 disabled:cursor-not-allowed`}>
              نسبة من الراتب
            </button>
          </div>
          {mode === 'amount' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">المبلغ لكل موظف (ل.س)</label>
              <input type="number" step="1000" className="input font-mono" value={amount}
                onChange={e => setAmount(e.target.value)} />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">النسبة لكل موظف (%)</label>
              <input type="number" step="0.5" min="0" max="100" className="input font-mono" value={percent}
                onChange={e => setPercent(e.target.value)} placeholder="10" />
              <p className="text-[11px] text-gray-500 mt-1">
                المبلغ سيُحسب لكل موظف بناءً على راتبه الأساس. الموظفون بدون راتب يُتجاهلون من السيرفر مع تنبيه.
              </p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">السبب (اختياري)</label>
            <input className="input" value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">الموظفون ({userIds.size})</label>
              <button
                type="button"
                onClick={() => setUserIds(new Set(employees.map(e => e.id)))}
                className="text-xs text-blue-600"
              >
                اختيار الكل
              </button>
            </div>
            <div className="border border-gray-200 rounded-xl p-2 max-h-60 overflow-y-auto space-y-1">
              {employees.map(e => {
                const checked = userIds.has(e.id)
                return (
                  <label key={e.id} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
                    <input type="checkbox" checked={checked} onChange={() => {
                      setUserIds(prev => {
                        const n = new Set(prev)
                        if (n.has(e.id)) n.delete(e.id); else n.add(e.id)
                        return n
                      })
                    }} />
                    <span className="text-sm">{e.name}</span>
                  </label>
                )
              })}
            </div>
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <button onClick={save} disabled={
            saving || userIds.size === 0 || (mode === 'amount' ? !amount : !percent)
          } className="btn-primary w-full justify-center">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            إضافة المكافأة لـ {userIds.size} موظف
          </button>
        </div>
      </div>
    </div>
  )
}

interface ManualBonusModalProps {
  employees: BonusEmployee[]
  defaultUserId?: string
  // When set, the modal switches to edit-mode: PATCH /api/bonuses/[id]
  // instead of POST. Employee select is locked, the title flips, and the
  // amount/reason inputs prefill from initial values.
  editingBonusId?: string
  initialAmount?: number
  initialReason?: string | null
  onClose: () => void
  onSaved: () => void
}

export function ManualBonusModal({
  employees, defaultUserId, editingBonusId,
  initialAmount, initialReason, onClose, onSaved,
}: ManualBonusModalProps) {
  const isEditing = !!editingBonusId
  const [userId, setUserId] = useState(defaultUserId || '')
  // Mode toggle between fixed amount and percent-of-salary. Edit-mode is
  // always 'amount' (the stored value is a plain number; we don't carry
  // the original percent through).
  const [mode, setMode] = useState<'amount' | 'percent'>('amount')
  const [amount, setAmount] = useState(initialAmount != null ? String(initialAmount) : '')
  const [percent, setPercent] = useState('')
  const [reason, setReason] = useState(initialReason || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selectedEmp = employees.find(e => e.id === userId)
  const salary = selectedEmp?.baseSalary ?? null
  const percentDisabled = isEditing || salary == null || salary <= 0
  const computedFromPercent = mode === 'percent' && salary && percent
    ? Math.round((salary * parseFloat(percent)) / 100)
    : null

  async function save() {
    if (!isEditing && !userId) return
    if (mode === 'amount' && !amount) return
    if (mode === 'percent' && !percent) return
    if (mode === 'percent' && !salary) {
      setError('الموظف بدون راتب أساس — تعذّر حساب النسبة')
      return
    }
    setSaving(true); setError('')
    try {
      const res = isEditing
        ? await fetch(`/api/bonuses/${editingBonusId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: parseFloat(amount),
              reason: reason || null,
            }),
          })
        : await fetch('/api/bonuses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'MANUAL',
              userId,
              ...(mode === 'percent'
                ? { percent: parseFloat(percent) }
                : { amount: parseFloat(amount) }),
              reason: reason || undefined,
            }),
          })
      const d = await res.json()
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
          <h2 className="font-bold flex items-center gap-2">
            <Award size={18} /> {isEditing ? 'تعديل مكافأة' : 'مكافأة فردية'}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">الموظف *</label>
            <select className="input" value={userId} onChange={e => setUserId(e.target.value)}
              disabled={!!defaultUserId || isEditing}>
              <option value="">— اختر موظفاً —</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.name}{e.employeeCode ? ` (${e.employeeCode})` : ''}</option>
              ))}
            </select>
          </div>
          {!isEditing && (
            <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-xs">
              <button type="button" onClick={() => setMode('amount')}
                className={`px-3 py-1 rounded-md ${mode === 'amount' ? 'bg-white shadow font-semibold' : 'text-gray-600'}`}>
                مبلغ ثابت
              </button>
              <button type="button" onClick={() => !percentDisabled && setMode('percent')} disabled={percentDisabled}
                title={percentDisabled ? 'الموظف بدون راتب أساس' : ''}
                className={`px-3 py-1 rounded-md ${mode === 'percent' ? 'bg-white shadow font-semibold' : 'text-gray-600'} disabled:opacity-50 disabled:cursor-not-allowed`}>
                نسبة من الراتب
              </button>
            </div>
          )}
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
                onChange={e => setPercent(e.target.value)} placeholder="10" />
              {salary && (
                <p className="text-[11px] text-gray-500 mt-1">
                  الراتب الأساس: <span className="font-mono">{salary.toLocaleString('en')}</span> ل.س
                  {computedFromPercent != null && (
                    <> · = <span className="font-mono font-semibold text-emerald-700">{computedFromPercent.toLocaleString('en')}</span> ل.س</>
                  )}
                </p>
              )}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">السبب (اختياري)</label>
            <input className="input" value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <button onClick={save} disabled={
            saving || (!isEditing && !userId) ||
            (mode === 'amount' ? !amount : !percent)
          } className="btn-primary w-full justify-center">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {isEditing ? 'حفظ التعديلات' : 'إضافة المكافأة'}
          </button>
        </div>
      </div>
    </div>
  )
}
