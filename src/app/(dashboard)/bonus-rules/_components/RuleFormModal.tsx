'use client'
// Phase D — create/edit modal for a BonusRule, with live preview.
import { useEffect, useMemo, useState } from 'react'
import { X, Save, Loader2, Plus, Trash2, Sparkles } from 'lucide-react'

export interface TierForm {
  streakMin: number
  streakMax: number | null
  amount: number | null
  percent: number | null
}

export interface RuleForForm {
  id: string
  name: string
  description: string | null
  interval: 'WEEKLY' | 'DAILY'
  amountType: 'FIXED' | 'PERCENT' | 'TIERED'
  baseAmount: number | null
  basePercent: number | null
  maxStreak: number | null
  cumulative: boolean
  isActive: boolean
  targetRoles?: string[]
  tiers: Array<{
    streakMin: number
    streakMax: number | null
    amount: number | null
    percent: number | null
  }>
}

// All roles a bonus rule can target. Display labels in Arabic; values
// match the UserRole enum on the backend.
const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'EMPLOYEE', label: 'موظف' },
  { value: 'SHIFT_MANAGER', label: 'مدير نوبة' },
  { value: 'MANAGER', label: 'مدير' },
  { value: 'SUPERVISOR', label: 'مشرف' },
  { value: 'ACCOUNT_MGR', label: 'مدير حساب' },
  { value: 'ADMIN', label: 'مسؤول' },
]

interface Props {
  rule?: RuleForForm
  onClose: () => void
  onSaved: () => void
}

const PREVIEW_STREAKS = [1, 4, 8, 12, 24]

export function RuleFormModal({ rule, onClose, onSaved }: Props) {
  const isEdit = !!rule
  const [name, setName] = useState(rule?.name ?? '')
  const [description, setDescription] = useState(rule?.description ?? '')
  const [interval, setIntervalVal] = useState<'WEEKLY' | 'DAILY'>(rule?.interval ?? 'WEEKLY')
  const [amountType, setAmountType] = useState<'FIXED' | 'PERCENT' | 'TIERED'>(rule?.amountType ?? 'FIXED')
  const [baseAmount, setBaseAmount] = useState<string>(rule?.baseAmount != null ? String(rule.baseAmount) : '5000')
  const [basePercent, setBasePercent] = useState<string>(rule?.basePercent != null ? String(rule.basePercent) : '5')
  const [maxStreak, setMaxStreak] = useState<string>(rule?.maxStreak != null ? String(rule.maxStreak) : '')
  const [cumulative, setCumulative] = useState<boolean>(rule?.cumulative ?? true)
  const [isActive, setIsActive] = useState<boolean>(rule?.isActive ?? true)
  // Default to EMPLOYEE-only for new rules. Existing rules keep their
  // stored targetRoles ([] means "applies to all roles").
  const [targetRoles, setTargetRoles] = useState<string[]>(rule?.targetRoles ?? ['EMPLOYEE'])
  const [tiers, setTiers] = useState<TierForm[]>(
    rule?.tiers?.length
      ? rule.tiers.map(t => ({
          streakMin: t.streakMin,
          streakMax: t.streakMax,
          amount: t.amount,
          percent: t.percent,
        }))
      : [
          { streakMin: 1, streakMax: 4, amount: 5000, percent: null },
          { streakMin: 5, streakMax: null, amount: 10000, percent: null },
        ],
  )
  const [previewSalary, setPreviewSalary] = useState<string>('200000')
  const [previewRows, setPreviewRows] = useState<Record<number, { amount: number; summary: string }>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const configPayload = useMemo(() => ({
    amountType,
    baseAmount: amountType === 'FIXED' ? toNum(baseAmount) : undefined,
    basePercent: amountType === 'PERCENT' ? toNum(basePercent) : undefined,
    maxStreak: toIntOrUndef(maxStreak),
    cumulative,
    tiers: amountType === 'TIERED'
      ? tiers.map(t => ({
          streakMin: Number(t.streakMin) || 0,
          streakMax: t.streakMax == null ? null : Number(t.streakMax),
          amount: t.amount == null ? null : Number(t.amount),
          percent: t.percent == null ? null : Number(t.percent),
        }))
      : [],
  }), [amountType, baseAmount, basePercent, maxStreak, cumulative, tiers])

  // Live preview — debounce-ish via simple effect.
  useEffect(() => {
    let cancelled = false
    const salaryNum = toNum(previewSalary)
    async function fetchAll() {
      const entries = await Promise.all(PREVIEW_STREAKS.map(async s => {
        try {
          const res = await fetch('/api/bonus-rules/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              config: configPayload,
              cleanStreak: s,
              baseSalary: salaryNum,
              name,
            }),
          })
          const d = await res.json()
          if (d.success) return [s, { amount: d.amount, summary: d.summary }] as const
          return [s, { amount: 0, summary: '—' }] as const
        } catch {
          return [s, { amount: 0, summary: '—' }] as const
        }
      }))
      if (cancelled) return
      const map: Record<number, { amount: number; summary: string }> = {}
      for (const [s, v] of entries) map[s] = v
      setPreviewRows(map)
    }
    const t = setTimeout(fetchAll, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [configPayload, previewSalary, name])

  function addTier() {
    setTiers(prev => {
      const last = prev[prev.length - 1]
      const nextMin = last ? (last.streakMax != null ? last.streakMax + 1 : last.streakMin + 1) : 1
      return [...prev, { streakMin: nextMin, streakMax: null, amount: 5000, percent: null }]
    })
  }
  function removeTier(i: number) {
    setTiers(prev => prev.filter((_, idx) => idx !== i))
  }
  function updateTier(i: number, patch: Partial<TierForm>) {
    setTiers(prev => prev.map((t, idx) => idx === i ? { ...t, ...patch } : t))
  }

  async function save() {
    setError('')
    if (!name.trim() && !isEdit) { setError('الاسم مطلوب'); return }
    if (amountType === 'FIXED' && !(toNum(baseAmount) ?? 0)) { setError('حدّد المبلغ الأساسي'); return }
    if (amountType === 'PERCENT' && !(toNum(basePercent) ?? 0)) { setError('حدّد النسبة'); return }
    if (amountType === 'TIERED' && tiers.length === 0) { setError('أضف طبقة واحدة على الأقل'); return }

    setSaving(true)
    try {
      const body = {
        description: description || null,
        interval,
        amountType,
        baseAmount: amountType === 'FIXED' ? toNum(baseAmount) ?? null : null,
        basePercent: amountType === 'PERCENT' ? toNum(basePercent) ?? null : null,
        maxStreak: toIntOrUndef(maxStreak) ?? null,
        cumulative,
        isActive,
        targetRoles,
        tiers: amountType === 'TIERED'
          ? tiers.map((t, i) => ({
              streakMin: Number(t.streakMin) || 0,
              streakMax: t.streakMax == null || String(t.streakMax) === '' ? null : Number(t.streakMax),
              amount: t.amount == null || String(t.amount) === '' ? null : Number(t.amount),
              percent: t.percent == null || String(t.percent) === '' ? null : Number(t.percent),
              order: i,
            }))
          : [],
      }
      let res: Response
      if (isEdit && rule) {
        res = await fetch(`/api/bonus-rules/${rule.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch('/api/bonus-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), ...body }),
        })
      }
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
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold flex items-center gap-2">
            <Sparkles size={18} className="text-amber-500" />
            {isEdit ? 'تعديل قاعدة المكافآت' : 'قاعدة مكافآت جديدة'}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
          {/* Form */}
          <div className="p-6 space-y-4 border-l border-gray-100">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">الاسم *</label>
              <input
                className="input" value={name} onChange={e => setName(e.target.value)}
                disabled={isEdit}
                placeholder="مثلاً: قاعدة المكافآت الذهبية"
              />
              {isEdit && (
                <p className="text-[10px] text-gray-400 mt-1">لا يمكن تعديل اسم قاعدة موجودة.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">الوصف</label>
              <input
                className="input" value={description ?? ''} onChange={e => setDescription(e.target.value)}
                placeholder="اختياري"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الفترة</label>
              <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-xs">
                {[{ v: 'WEEKLY', label: 'أسبوعية' }, { v: 'DAILY', label: 'يومية' }].map(o => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setIntervalVal(o.v as 'WEEKLY' | 'DAILY')}
                    className={`px-3 py-1 rounded-md ${interval === o.v ? 'bg-white shadow font-semibold' : 'text-gray-600'}`}
                  >{o.label}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">النوع</label>
              <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-xs">
                {[
                  { v: 'FIXED', label: 'مبلغ ثابت' },
                  { v: 'PERCENT', label: 'نسبة من الراتب' },
                  { v: 'TIERED', label: 'متدرّجة' },
                ].map(o => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setAmountType(o.v as 'FIXED' | 'PERCENT' | 'TIERED')}
                    className={`px-3 py-1 rounded-md ${amountType === o.v ? 'bg-white shadow font-semibold' : 'text-gray-600'}`}
                  >{o.label}</button>
                ))}
              </div>
            </div>

            {amountType === 'FIXED' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">المبلغ لكل أسبوع نظيف (ل.س)</label>
                <input type="number" step="500" className="input font-mono"
                  value={baseAmount} onChange={e => setBaseAmount(e.target.value)} />
              </div>
            )}
            {amountType === 'PERCENT' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">النسبة (%) لكل فترة</label>
                <input type="number" step="0.5" min="0" max="100" className="input font-mono"
                  value={basePercent} onChange={e => setBasePercent(e.target.value)} />
              </div>
            )}
            {amountType === 'TIERED' && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">الطبقات</label>
                <div className="space-y-2">
                  {tiers.map((t, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded-lg p-2">
                      <input
                        type="number" min="0"
                        className="input py-1 text-xs col-span-3 font-mono"
                        placeholder="من"
                        value={t.streakMin}
                        onChange={e => updateTier(i, { streakMin: Number(e.target.value) })}
                      />
                      <input
                        type="number" min="0"
                        className="input py-1 text-xs col-span-3 font-mono"
                        placeholder="إلى (فارغ = ∞)"
                        value={t.streakMax ?? ''}
                        onChange={e => updateTier(i, { streakMax: e.target.value === '' ? null : Number(e.target.value) })}
                      />
                      <input
                        type="number" step="500" min="0"
                        className="input py-1 text-xs col-span-3 font-mono"
                        placeholder="مبلغ"
                        value={t.amount ?? ''}
                        onChange={e => updateTier(i, {
                          amount: e.target.value === '' ? null : Number(e.target.value),
                          percent: e.target.value === '' ? t.percent : null,
                        })}
                      />
                      <input
                        type="number" step="0.5" min="0" max="100"
                        className="input py-1 text-xs col-span-2 font-mono"
                        placeholder="%"
                        value={t.percent ?? ''}
                        onChange={e => updateTier(i, {
                          percent: e.target.value === '' ? null : Number(e.target.value),
                          amount: e.target.value === '' ? t.amount : null,
                        })}
                      />
                      <button
                        type="button" onClick={() => removeTier(i)}
                        className="btn-ghost p-1.5 text-rose-500 col-span-1"
                        title="حذف الطبقة"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addTier} className="btn-secondary btn-sm">
                  <Plus size={13} /> إضافة طبقة
                </button>
                <p className="text-[10px] text-gray-400">
                  املأ المبلغ <strong>أو</strong> النسبة لكل طبقة — وليس كليهما.
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">السقف الأقصى للأسابيع (اختياري)</label>
              <input
                type="number" min="0" className="input font-mono"
                value={maxStreak} onChange={e => setMaxStreak(e.target.value)}
                placeholder="اتركه فارغاً لإلغاء السقف"
              />
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cumulative}
                  onChange={e => setCumulative(e.target.checked)} />
                تراكمي (يجمع عبر الأسابيع)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isActive}
                  onChange={e => setIsActive(e.target.checked)} />
                نشطة
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">تُطبَّق على الأدوار</label>
              <p className="text-[10px] text-gray-400 mb-2">
                اختر الأدوار التي تستحق هذه المكافأة. لا اختيار = تُطبَّق على جميع الموظفين النشطين.
              </p>
              <div className="flex flex-wrap gap-2">
                {ROLE_OPTIONS.map(r => {
                  const checked = targetRoles.includes(r.value)
                  return (
                    <label
                      key={r.value}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border cursor-pointer text-xs transition ${
                        checked
                          ? 'bg-amber-50 border-amber-300 text-amber-800'
                          : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="accent-amber-500"
                        checked={checked}
                        onChange={() => {
                          setTargetRoles(prev =>
                            checked ? prev.filter(v => v !== r.value) : [...prev, r.value],
                          )
                        }}
                      />
                      {r.label}
                    </label>
                  )
                })}
              </div>
            </div>

            {error && <p className="text-red-600 text-xs">{error}</p>}
            <button onClick={save} disabled={saving}
              className="btn-primary w-full justify-center">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              حفظ القاعدة
            </button>
          </div>

          {/* Live preview */}
          <div className="p-6 space-y-3 bg-gradient-to-bl from-amber-50/40 to-white">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <Sparkles size={14} className="text-amber-500" /> معاينة فورية
            </h3>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">الراتب الأساس (للنسبة)</label>
              <input
                type="number" step="10000" className="input font-mono text-sm"
                value={previewSalary} onChange={e => setPreviewSalary(e.target.value)}
              />
            </div>
            <table className="w-full text-sm">
              <thead className="bg-white">
                <tr>
                  <th className="px-2 py-1 text-right font-semibold text-gray-600 text-xs">الأسابيع النظيفة</th>
                  <th className="px-2 py-1 text-left font-semibold text-gray-600 text-xs">المكافأة</th>
                </tr>
              </thead>
              <tbody>
                {PREVIEW_STREAKS.map(s => {
                  const row = previewRows[s]
                  return (
                    <tr key={s} className="border-t border-amber-100">
                      <td className="px-2 py-1.5 font-mono text-gray-700">{s}</td>
                      <td className="px-2 py-1.5 font-mono font-bold text-amber-700 text-left">
                        {row ? row.amount.toLocaleString('en') : '…'} <span className="text-[10px] text-gray-400">ل.س</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {previewRows[8] && (
              <p className="text-[11px] text-gray-500 leading-relaxed">
                {previewRows[8].summary}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function toNum(v: string): number | undefined {
  if (v === '' || v == null) return undefined
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}

function toIntOrUndef(v: string): number | undefined {
  if (v === '' || v == null) return undefined
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : undefined
}
