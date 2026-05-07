'use client'
import { useState } from 'react'
import { X, Loader2, Save, Trash2 } from 'lucide-react'
import { fmtSyria } from '@/lib/datetime'
import { Transaction, TxStatus, REVIEW_LABELS, STATUS_LABELS, TYPE_LABELS } from './types'

interface EditData {
  id: string
  status: TxStatus
  amount: string
  shamCashTxId: string
  platformTxId: string
  platformUserId: string
  notes: string
  reviewCategory: string    // '' means keep current; 'NONE' means clear; otherwise ReviewCat
  reviewNotes: string
}

export function EditModal({ tx, onClose, onSaved }: { tx: Transaction; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<EditData>({
    id: tx.id,
    status: tx.status,
    amount: String(tx.amount),
    shamCashTxId: tx.shamCashTxId || '',
    platformTxId: tx.platformTxId || '',
    platformUserId: tx.platformUserId || '',
    notes: tx.notes || '',
    reviewCategory: tx.reviewCategory || '',
    reviewNotes: tx.reviewNotes || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const showReview = tx.status !== 'MATCHED'

  async function handleSave() {
    setSaving(true); setError('')
    try {
      // Figure out what review payload to send:
      //  '' (unchanged)  → don't send review fields
      //  'NONE'          → clear review
      //  ReviewCat       → set review
      const reviewPayload: Record<string, string | undefined> = {}
      const originalCategory = tx.reviewCategory || ''
      if (form.reviewCategory !== originalCategory) {
        reviewPayload.reviewCategory = form.reviewCategory === '' ? undefined : form.reviewCategory
      }
      // Always send reviewNotes if it changed (even without category change)
      if ((form.reviewNotes || '') !== (tx.reviewNotes || '')) {
        reviewPayload.reviewNotes = form.reviewNotes || ''
      }

      const res = await fetch('/api/transactions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: form.id,
          status: form.status,
          amount: parseFloat(form.amount) || undefined,
          shamCashTxId: form.shamCashTxId || undefined,
          platformTxId: form.platformTxId || undefined,
          platformUserId: form.platformUserId || undefined,
          notes: form.notes || undefined,
          ...reviewPayload,
        }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('هل أنت متأكد من حذف هذه العملية؟')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/transactions?id=${tx.id}`, { method: 'DELETE' })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg m-4 animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800">تعديل العملية</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Info header */}
          <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500 space-y-1">
            <div className="flex justify-between"><span>النوع:</span><span className="font-semibold text-gray-700">{TYPE_LABELS[tx.type]}</span></div>
            <div className="flex justify-between"><span>المصدر:</span><span className="font-semibold text-gray-700">{tx.source === 'SHAM_CASH' ? 'شام كاش' : 'المنصة'}</span></div>
            <div className="flex justify-between"><span>التاريخ:</span><span className="font-mono text-gray-700">{fmtSyria(tx.txDateTime)}</span></div>
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">الحالة</label>
            <select className="input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value as TxStatus })}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">المبلغ</label>
            <input type="number" step="0.01" className="input font-mono" value={form.amount}
              onChange={e => setForm({ ...form, amount: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* SC TX ID */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">رقم شام كاش</label>
              <input className="input font-mono text-sm" value={form.shamCashTxId}
                onChange={e => setForm({ ...form, shamCashTxId: e.target.value })} />
            </div>
            {/* Platform TX ID */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">رقم المنصة</label>
              <input className="input font-mono text-sm" value={form.platformTxId}
                onChange={e => setForm({ ...form, platformTxId: e.target.value })} />
            </div>
          </div>

          {/* User ID */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">User ID</label>
            <input className="input font-mono text-sm" value={form.platformUserId}
              onChange={e => setForm({ ...form, platformUserId: e.target.value })} />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">ملاحظات</label>
            <textarea className="input min-h-[60px]" value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>

          {/* Manual Review */}
          {showReview && (
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-semibold text-gray-700">نتيجة المراجعة اليدوية</label>
                {tx.reviewedAt && (
                  <span className="text-[10px] text-gray-400">
                    مُراجَع في {fmtSyria(tx.reviewedAt, false)}
                  </span>
                )}
              </div>
              <select
                className="input"
                value={form.reviewCategory}
                onChange={e => setForm({ ...form, reviewCategory: e.target.value })}
              >
                <option value="">— لم تتم المراجعة بعد —</option>
                {Object.entries(REVIEW_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
                {tx.reviewCategory && <option value="NONE">إلغاء المراجعة</option>}
              </select>
              <textarea
                className="input min-h-[60px] text-sm"
                placeholder="توضيح المراجع (اختياري)"
                value={form.reviewNotes}
                onChange={e => setForm({ ...form, reviewNotes: e.target.value })}
              />
            </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          <button onClick={handleDelete} disabled={saving} className="btn-danger btn-sm">
            <Trash2 size={14} /> حذف
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-secondary btn-sm">إلغاء</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary btn-sm">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              حفظ التعديلات
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
