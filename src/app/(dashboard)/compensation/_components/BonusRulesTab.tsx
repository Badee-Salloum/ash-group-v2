'use client'
// Phase D — admin page: manage cumulative bonus rules.
import { SortableTable } from '@/components/tables/SortableTable'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Plus, Pencil, Trash2, Sparkles, ArrowRight, RefreshCw } from 'lucide-react'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { fmtSYP } from '@/lib/currency'
import { RuleFormModal, RuleForForm } from '../../bonus-rules/_components/RuleFormModal'

interface RuleRow {
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
  targetRoles: string[]
  tiers: Array<{
    id: string
    streakMin: number
    streakMax: number | null
    amount: number | null
    percent: number | null
    order: number
  }>
  createdAt: string
}

const TYPE_LABEL: Record<string, string> = {
  FIXED: 'مبلغ ثابت',
  PERCENT: 'نسبة من الراتب',
  TIERED: 'متدرّجة',
}

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: 'موظف',
  SHIFT_MANAGER: 'مدير نوبة',
  MANAGER: 'مدير',
  SUPERVISOR: 'مشرف',
  ACCOUNT_MGR: 'مدير حساب',
  ACCOUNTANT: 'محاسب',
  ADMIN: 'مسؤول',
}

export function BonusRulesTab() {
  const [rules, setRules] = useState<RuleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<RuleRow | null>(null)
  const [preview, setPreview] = useState<{ amount: number; summary: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const confirm = useConfirm()
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/bonus-rules')
      const d = await r.json()
      if (d.success) setRules(d.data)
      else setMsg('خطأ: ' + (d.error || 'تعذّر التحميل'))
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Fetch a sample preview for the active rule's footer card.
  const active = rules.find(r => r.isActive)
  useEffect(() => {
    if (!active) { setPreview(null); return }
    setPreviewLoading(true)
    const config = {
      amountType: active.amountType,
      baseAmount: active.baseAmount ?? undefined,
      basePercent: active.basePercent ?? undefined,
      maxStreak: active.maxStreak ?? undefined,
      cumulative: active.cumulative,
      tiers: active.tiers.map(t => ({
        streakMin: t.streakMin,
        streakMax: t.streakMax,
        amount: t.amount,
        percent: t.percent,
      })),
    }
    fetch('/api/bonus-rules/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, cleanStreak: 5, baseSalary: 200000, name: active.name }),
    }).then(r => r.json()).then(d => {
      if (d.success) setPreview({ amount: d.amount, summary: d.summary })
    }).finally(() => setPreviewLoading(false))
  }, [active])

  async function deleteRule(r: RuleRow) {
    if (r.isActive) {
      toast('لا يمكن حذف القاعدة النشطة — فعّل قاعدة أخرى أولاً.', 'error')
      return
    }
    if (!(await confirm(`حذف القاعدة "${r.name}"؟ (سيتم تعطيلها)`))) return
    try {
      const res = await fetch(`/api/bonus-rules?id=${r.id}`, { method: 'DELETE' })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setMsg(`عُطّلت القاعدة "${r.name}"`)
      load()
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  function ruleAmountLabel(r: RuleRow): string {
    if (r.amountType === 'FIXED') {
      return r.baseAmount != null ? `${fmtSYP(r.baseAmount)} / فترة` : '—'
    }
    if (r.amountType === 'PERCENT') {
      return r.basePercent != null ? `${r.basePercent}% من الراتب` : '—'
    }
    return `${r.tiers.length} طبقة`
  }

  function toFormShape(r: RuleRow): RuleForForm {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      interval: r.interval,
      amountType: r.amountType,
      baseAmount: r.baseAmount,
      basePercent: r.basePercent,
      maxStreak: r.maxStreak,
      cumulative: r.cumulative,
      isActive: r.isActive,
      targetRoles: r.targetRoles ?? [],
      tiers: r.tiers.map(t => ({
        streakMin: t.streakMin,
        streakMax: t.streakMax,
        amount: t.amount,
        percent: t.percent,
      })),
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/compensation" className="btn-secondary btn-sm">
          <ArrowRight size={14} /> التعويضات والأداء
        </Link>
        <Link href="/bonuses" className="btn-secondary btn-sm">
          <Sparkles size={14} /> داشبورد المكافآت
        </Link>
      </div>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">قواعد المكافآت التراكمية</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            حدّد كيف تُحسب المكافأة على الأسابيع النظيفة. قاعدة واحدة فقط نشطة في كل وقت.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={load} className="btn-secondary btn-sm" title="تحديث">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary btn-sm">
            <Plus size={14} /> قاعدة جديدة
          </button>
        </div>
      </div>

      {msg && (
        <div className={`text-sm px-4 py-2 rounded-lg ${msg.startsWith('خطأ') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {msg}
        </div>
      )}

      {loading ? (
        <div className="card p-12 text-center text-gray-400">
          <Loader2 size={28} className="mx-auto animate-spin mb-2" /> جاري التحميل...
        </div>
      ) : rules.length === 0 ? (
        <div className="card p-10 text-center text-gray-500">
          <Sparkles size={28} className="mx-auto text-amber-400 mb-3" />
          <p className="font-semibold mb-1">لا توجد قواعد بعد</p>
          <p className="text-xs text-gray-400 mb-4">أنشئ قاعدتك الأولى لبدء صرف المكافآت تلقائياً.</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={14} /> قاعدة جديدة
          </button>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <SortableTable className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">الاسم</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">النوع</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">المبلغ / النسبة</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">السقف</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">الحالة</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id}
                  className="border-t border-gray-100 hover:bg-blue-50/30 cursor-pointer"
                  onClick={() => setEditing(r)}
                >
                  <td data-sort-value={r.name} className="px-3 py-2">
                    <p className="font-medium text-gray-900">{r.name}</p>
                    {r.description && <p className="text-[11px] text-gray-500">{r.description}</p>}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {r.targetRoles && r.targetRoles.length > 0 ? (
                        r.targetRoles.map(role => (
                          <span key={role} className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">
                            {ROLE_LABEL[role] ?? role}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-gray-400">جميع الأدوار</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{TYPE_LABEL[r.amountType] ?? r.amountType}</td>
                  <td data-sort-value={{ [r.amountType]: r.baseAmount ?? r.basePercent }} className="px-3 py-2 font-mono text-gray-700">{ruleAmountLabel(r)}</td>
                  <td data-sort-value={r.maxStreak} className="px-3 py-2 text-center text-gray-700">
                    {r.maxStreak != null ? `${r.maxStreak} فترة` : <span className="text-gray-300">∞</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.isActive
                      ? <span className="badge bg-emerald-100 text-emerald-700">نشطة</span>
                      : <span className="badge bg-gray-100 text-gray-500">معطّلة</span>
                    }
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditing(r) }}
                        className="btn-ghost btn-sm p-1.5 text-blue-500 hover:bg-blue-50"
                        title="تعديل"
                      >
                        <Pencil size={13} />
                      </button>
                      {!r.isActive && (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteRule(r) }}
                          className="btn-ghost btn-sm p-1.5 text-rose-500 hover:bg-rose-50"
                          title="حذف"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </SortableTable>
        </div>
      )}

      {/* Active rule preview footer */}
      {active && (
        <div className="card p-4 bg-gradient-to-l from-amber-50 to-white">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={16} className="text-amber-500" />
            <h2 className="font-bold text-gray-800">القاعدة النشطة: {active.name}</h2>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-gray-600">
              عيّنة: 5 أسابيع نظيفة × راتب 200,000 ل.س
            </p>
            {previewLoading ? (
              <Loader2 size={14} className="animate-spin text-amber-500" />
            ) : preview ? (
              <p className="text-sm font-mono font-bold text-amber-700">
                = {fmtSYP(preview.amount)}
                <span className="text-[10px] text-gray-500 mr-2">({preview.summary})</span>
              </p>
            ) : (
              <span className="text-xs text-gray-400">—</span>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <RuleFormModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); setMsg('أُنشئت القاعدة'); load() }}
        />
      )}
      {editing && (
        <RuleFormModal
          rule={toFormShape(editing)}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setMsg('حُدّثت القاعدة'); load() }}
        />
      )}
    </div>
  )
}
