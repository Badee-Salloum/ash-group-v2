'use client'
import { useState } from 'react'
import { X, Loader2, Save, ExternalLink } from 'lucide-react'
import { fmtSyria } from '@/lib/datetime'
import {
  FollowUpRow, AssigneeUser, FollowUpStatus, TxStatus, ReviewCategory,
  STATUS_LABELS, CATEGORY_LABELS, TYPE_LABELS, SOURCE_LABELS,
  TX_STATUS_LABELS, REVIEW_CATEGORY_LABELS,
} from './types'

// One transaction ID — label above, large mono value. Always LTR.
function IdField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-[88px]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="font-mono text-sm font-bold text-slate-800">{value || '—'}</p>
    </div>
  )
}

interface Props {
  row: FollowUpRow
  assignees: AssigneeUser[]
  currentUserId: string
  onClose: () => void
  onSaved: () => void
}

const STATUS_OPTIONS: FollowUpStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']

export function FollowUpModal({ row, assignees, currentUserId, onClose, onSaved }: Props) {
  const [status, setStatus] = useState<FollowUpStatus>(row.followUpStatus ?? 'OPEN')
  const [assignedTo, setAssignedTo] = useState<string>(row.followUpAssignedTo ?? '')
  const [resolution, setResolution] = useState<string>(row.followUpResolution ?? '')
  // The underlying transaction's own status + review category.
  const [txStatus, setTxStatus] = useState<TxStatus>(row.status)
  const [reviewCategory, setReviewCategory] = useState<ReviewCategory | ''>(row.reviewCategory ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const requiresResolution = status === 'RESOLVED' || status === 'CLOSED'

  async function handleSave() {
    setError('')
    if (requiresResolution && !resolution.trim()) {
      setError('يرجى كتابة ملاحظة الحل قبل الإغلاق')
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, string | null> = {}
      if (status !== row.followUpStatus) payload.followUpStatus = status
      if ((assignedTo || '') !== (row.followUpAssignedTo || '')) {
        payload.followUpAssignedTo = assignedTo
      }
      if ((resolution || '') !== (row.followUpResolution || '')) {
        payload.followUpResolution = resolution
      }
      if (txStatus !== row.status) payload.status = txStatus
      if ((reviewCategory || '') !== (row.reviewCategory || '')) {
        payload.reviewCategory = reviewCategory || null
      }
      if (Object.keys(payload).length === 0) {
        onClose()
        return
      }
      const r = await fetch(`/api/follow-ups/${row.id}`, {
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

  function assignToMe() {
    setAssignedTo(currentUserId)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl animate-fade-in max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-bold text-gray-800">إدارة المتابعة</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {row.reviewCategory && CATEGORY_LABELS[row.reviewCategory]}
              {' · '}{row.accountName}
              {' · '}{TYPE_LABELS[row.type]}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1 min-h-0">
          {/* Operation summary */}
          <div className="bg-slate-50 rounded-xl p-4 text-sm">
            {/* Transaction IDs — prominent, top-left */}
            <div dir="ltr" className="flex flex-wrap gap-x-6 gap-y-2 pb-3 mb-3 border-b border-slate-200">
              <IdField label="شام كاش" value={row.shamCashTxId} />
              <IdField label="المنصة" value={row.platformTxId} />
              <IdField label="User ID" value={row.platformUserId} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">المبلغ:</span>
                <span className="font-mono font-semibold text-slate-800">
                  {Number(row.amount).toLocaleString()} {row.currency}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">المصدر:</span>
                <span className="text-slate-700">{SOURCE_LABELS[row.source]}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">تاريخ العملية:</span>
                <span className="font-mono text-slate-700">{fmtSyria(row.txDateTime)}</span>
              </div>
              {row.reviewNotes && (
                <div className="pt-2 border-t border-slate-200">
                  <p className="text-slate-500 text-xs mb-1">ملاحظة المراجع:</p>
                  <p className="text-slate-700 whitespace-pre-wrap">{row.reviewNotes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Transaction status */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">حالة العملية</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(Object.keys(TX_STATUS_LABELS) as TxStatus[]).map(s => {
                const meta = TX_STATUS_LABELS[s]
                const active = txStatus === s
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTxStatus(s)}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold ring-1 transition-colors ${
                      active ? meta.cls : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {meta.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Review category */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">فئة المراجعة</label>
            <select
              value={reviewCategory}
              onChange={e => setReviewCategory(e.target.value as ReviewCategory | '')}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">— بدون فئة —</option>
              {(Object.keys(REVIEW_CATEGORY_LABELS) as ReviewCategory[]).map(c => (
                <option key={c} value={c}>{REVIEW_CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>

          {/* Follow-up status */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">حالة المتابعة</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STATUS_OPTIONS.map(s => {
                const meta = STATUS_LABELS[s]
                const active = status === s
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold ring-1 transition-colors ${
                      active ? meta.cls : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {meta.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Assignee */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-semibold text-slate-700">المُسنَد إليه</label>
              <button
                type="button"
                onClick={assignToMe}
                className="text-xs font-semibold text-sky-600 hover:text-sky-700"
              >
                إسناد لي
              </button>
            </div>
            <select
              value={assignedTo}
              onChange={e => setAssignedTo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">— غير مُسنَد —</option>
              {assignees.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
          </div>

          {/* Resolution */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              ملاحظة الحل {requiresResolution && <span className="text-red-500">*</span>}
            </label>
            <textarea
              value={resolution}
              onChange={e => setResolution(e.target.value)}
              placeholder={requiresResolution ? 'وصف ما تم (اتصال، استرجاع، إغلاق…) — مطلوب' : 'وصف ما تم أو ما يُتابَع'}
              rows={4}
              maxLength={2000}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-none"
            />
            <p className="text-[11px] text-slate-400 mt-1">{resolution.length}/2000</p>
          </div>

          {/* Resolved metadata (read-only) */}
          {row.followUpResolvedAt && (
            <div className="bg-emerald-50 ring-1 ring-emerald-100 rounded-lg p-3 text-xs text-emerald-700">
              أُغلقت في {fmtSyria(row.followUpResolvedAt)}
              {row.followUpResolvedByName && ` بواسطة ${row.followUpResolvedByName}`}
            </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between shrink-0">
          <a
            href={`/reconciliation?focus=${row.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            <ExternalLink size={12} /> فتح في صفحة المطابقة
          </a>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold disabled:opacity-50">
              إلغاء
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              حفظ
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
