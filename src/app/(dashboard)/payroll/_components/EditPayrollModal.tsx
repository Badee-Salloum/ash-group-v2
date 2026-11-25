'use client'
import { useState } from 'react'
import { X, Loader2, Save, Lock } from 'lucide-react'

export interface EditPayrollTarget {
  id: string
  userName: string
  weekLabel: string
  baseSalary: number
  workedHours: number
  expectedHours: number
  bonusAmount: number
  deductions: number
  advanceAmount: number
  netAmount: number
  status: 'DRAFT' | 'CONFIRMED' | 'PAID'
  notes: string | null
}

interface Props {
  target: EditPayrollTarget
  onClose: () => void
  onSaved: () => void
}

// PATCH /api/payroll modal — exposes the editable subset of a PayrollEntry
// (bonusAmount, deductions, notes). For PAID rows we only let the user
// adjust the notes field; amounts are frozen on the server too (the API
// returns 4xx on amount changes for PAID entries) but the UI hard-disables
// the inputs so the friction is obvious.
export function EditPayrollModal({ target, onClose, onSaved }: Props) {
  const isPaid = target.status === 'PAID'
  const [bonusAmount, setBonusAmount] = useState(String(target.bonusAmount))
  const [deductions, setDeductions] = useState(String(target.deductions))
  // Independent percent-of-salary toggles for bonus + deductions. Editing
  // is always in plain SYP under the hood — the percent UI just computes
  // the resolved amount client-side and overwrites the *Amount state.
  const [bonusMode, setBonusMode] = useState<'amount' | 'percent'>('amount')
  const [bonusPercent, setBonusPercent] = useState('')
  const [deductionMode, setDeductionMode] = useState<'amount' | 'percent'>('amount')
  const [deductionPercent, setDeductionPercent] = useState('')
  const [notes, setNotes] = useState(target.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const percentDisabled = !target.baseSalary || target.baseSalary <= 0

  // Resolved values used by both the preview and the submit payload.
  const resolvedBonus = bonusMode === 'percent' && bonusPercent && target.baseSalary
    ? Math.round((target.baseSalary * parseFloat(bonusPercent)) / 100)
    : parseFloat(bonusAmount) || 0
  const resolvedDeductions = deductionMode === 'percent' && deductionPercent && target.baseSalary
    ? Math.round((target.baseSalary * parseFloat(deductionPercent)) / 100)
    : parseFloat(deductions) || 0

  // Live preview of the net amount based on the user's edits.
  const dailyRate = target.expectedHours > 0
    ? target.baseSalary / target.expectedHours
    : 0
  const proRated = dailyRate * target.workedHours
  const previewNet = isPaid
    ? target.netAmount
    : proRated + resolvedBonus - target.advanceAmount - resolvedDeductions

  async function save() {
    setSaving(true); setError('')
    try {
      const payload: Record<string, unknown> = { id: target.id, notes: notes || null }
      if (!isPaid) {
        payload.bonusAmount = resolvedBonus
        payload.deductions = resolvedDeductions
      }
      const r = await fetch('/api/payroll', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
          <div>
            <h2 className="font-bold">تعديل راتب</h2>
            <p className="text-xs text-gray-500 mt-0.5">{target.userName} · {target.weekLabel}</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          {isPaid && (
            <div className="text-xs bg-emerald-50 border border-emerald-100 text-emerald-700 px-3 py-2 rounded-lg flex items-center gap-2">
              <Lock size={14} /> هذه الـ entry مدفوعة — يمكن تعديل الملاحظات فقط.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AmountField
              label="المكافأة"
              tone="emerald"
              isPaid={isPaid}
              percentDisabled={percentDisabled}
              mode={bonusMode}
              setMode={setBonusMode}
              amount={bonusAmount}
              setAmount={setBonusAmount}
              percent={bonusPercent}
              setPercent={setBonusPercent}
              baseSalary={target.baseSalary}
              resolved={resolvedBonus}
            />
            <AmountField
              label="الخصومات"
              tone="rose"
              isPaid={isPaid}
              percentDisabled={percentDisabled}
              mode={deductionMode}
              setMode={setDeductionMode}
              amount={deductions}
              setAmount={setDeductions}
              percent={deductionPercent}
              setPercent={setDeductionPercent}
              baseSalary={target.baseSalary}
              resolved={resolvedDeductions}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">ملاحظات</label>
            <textarea className="input min-h-[60px]" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="سبب التعديل، أي تفاصيل…" />
          </div>

          {/* Live net-amount preview */}
          <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-1">
            <Row label="الأساس × أيام العمل" value={proRated} />
            <Row label="+ المكافأة" value={resolvedBonus} />
            <Row label="− السلف" value={-target.advanceAmount} />
            <Row label="− الخصومات" value={-resolvedDeductions} />
            <div className="border-t border-slate-200 pt-1.5 flex items-center justify-between font-bold">
              <span>الصافي</span>
              <span className="font-mono text-base">{previewNet.toLocaleString('en')} ل.س</span>
            </div>
          </div>

          {error && <p className="text-red-600 text-xs">{error}</p>}

          <button onClick={save} disabled={saving} className="btn-primary w-full justify-center">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            حفظ التعديلات
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-mono">{value.toLocaleString('en')}</span>
    </div>
  )
}

// Dual-mode amount field with built-in percent toggle. Shared by both the
// bonus and the deduction inputs in EditPayrollModal — each instance has
// independent state, so a user can set the bonus by percent and the
// deduction by fixed amount in the same edit.
function AmountField({
  label, tone, isPaid, percentDisabled,
  mode, setMode, amount, setAmount, percent, setPercent,
  baseSalary, resolved,
}: {
  label: string
  tone: 'emerald' | 'rose'
  isPaid: boolean
  percentDisabled: boolean
  mode: 'amount' | 'percent'
  setMode: (m: 'amount' | 'percent') => void
  amount: string
  setAmount: (v: string) => void
  percent: string
  setPercent: (v: string) => void
  baseSalary: number
  resolved: number
}) {
  const previewCls = tone === 'emerald' ? 'text-emerald-700' : 'text-rose-700'
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-xs font-semibold text-gray-700">{label} (ل.س)</label>
        <div className="inline-flex rounded-md bg-gray-100 p-0.5 text-[10px]">
          <button
            type="button"
            onClick={() => setMode('amount')}
            disabled={isPaid}
            className={`px-2 py-0.5 rounded ${
              mode === 'amount' ? 'bg-white shadow font-semibold' : 'text-gray-600'
            } disabled:opacity-50`}
          >
            مبلغ
          </button>
          <button
            type="button"
            onClick={() => !percentDisabled && setMode('percent')}
            disabled={isPaid || percentDisabled}
            title={percentDisabled ? 'لا يوجد راتب أساس' : ''}
            className={`px-2 py-0.5 rounded ${
              mode === 'percent' ? 'bg-white shadow font-semibold' : 'text-gray-600'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            نسبة %
          </button>
        </div>
      </div>
      {mode === 'amount' ? (
        <input
          type="number"
          step="1000"
          className="input font-mono"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          disabled={isPaid}
        />
      ) : (
        <>
          <input
            type="number"
            step="0.5"
            min="0"
            max="100"
            className="input font-mono"
            value={percent}
            onChange={e => setPercent(e.target.value)}
            disabled={isPaid}
            placeholder="5"
          />
          <p className="text-[10px] text-gray-500">
            من <span className="font-mono">{baseSalary.toLocaleString('en')}</span>{' '}
            ل.س ={' '}
            <span className={`font-mono font-semibold ${previewCls}`}>
              {resolved.toLocaleString('en')}
            </span>{' '}
            ل.س
          </p>
        </>
      )}
    </div>
  )
}
