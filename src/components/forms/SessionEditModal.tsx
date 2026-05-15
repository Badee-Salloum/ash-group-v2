'use client'
import { useState } from 'react'
import { X, Save, Loader2 } from 'lucide-react'

export interface SessionLite {
  id: string
  userId: string
  user: { id: string; name: string }
  shiftNumber: 'ONE' | 'TWO' | 'THREE' | null
  startAt: string
  endAt: string | null
  notes?: string | null
  status: 'ACTIVE' | 'PENDING_END' | 'PENDING_START' | 'COMPLETED' | 'CANCELLED'
  wallets: Array<{ accountId: string }>
}

export interface WalletAccount {
  id: string
  name: string
  currency: string
}

interface Props {
  session: SessionLite
  /** All wallets this employee may be assigned to (server-validated). */
  allowedWallets: WalletAccount[]
  /** Pass true to expose admin-only fields (shiftNumber, time corrections). */
  isAdminTier: boolean
  onClose: () => void
  onSaved: () => void
}

const SHIFT_LABEL: Record<'ONE' | 'TWO' | 'THREE', string> = {
  ONE: 'الأولى (06:00–14:00)',
  TWO: 'الثانية (14:00–22:00)',
  THREE: 'الثالثة (22:00–06:00)',
}

// Convert an ISO timestamp to the value a <input type="datetime-local"> wants:
// 'YYYY-MM-DDTHH:MM' in *local* time. Browser then sends it back as a local
// string which we re-parse to ISO on submit.
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function SessionEditModal({
  session, allowedWallets, isAdminTier, onClose, onSaved,
}: Props) {
  const isOpen = session.status === 'ACTIVE'
    || session.status === 'PENDING_END'
    || session.status === 'PENDING_START'
  const [notes, setNotes] = useState(session.notes ?? '')
  const [shiftNumber, setShiftNumber] = useState<'ONE' | 'TWO' | 'THREE' | ''>(session.shiftNumber ?? '')
  const [walletIds, setWalletIds] = useState<Set<string>>(
    new Set(session.wallets.map(w => w.accountId)),
  )
  const [startAt, setStartAt] = useState(toLocalInput(session.startAt))
  const [endAt, setEndAt] = useState(toLocalInput(session.endAt))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function toggleWallet(id: string) {
    const next = new Set(walletIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setWalletIds(next)
  }

  async function handleSave() {
    setErr('')
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        action: 'edit',
        sessionId: session.id,
        notes: notes || null,
        walletIds: [...walletIds],
      }
      if (isAdminTier) {
        body.shiftNumber = shiftNumber || null
        if (startAt) body.startAt = new Date(startAt).toISOString()
        if (endAt) body.endAt = new Date(endAt).toISOString()
        else if (!isOpen) body.endAt = null
      }
      const r = await fetch('/api/shifts/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error || 'فشل التعديل')
      onSaved()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="font-bold text-gray-800">تعديل الجلسة — {session.user.name}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="إغلاق"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-4">
          {/* Notes — everyone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="input"
              placeholder="ملاحظة قصيرة (اختياري)"
            />
          </div>

          {/* Wallets — everyone (validated server-side against the user's assignments) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">المحافظ</label>
            {allowedWallets.length === 0 ? (
              <p className="text-xs text-gray-400">لا توجد محافظ مسموح بها لهذا الموظف.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {allowedWallets.map(w => {
                  const checked = walletIds.has(w.id)
                  return (
                    <label key={w.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm ${
                      checked ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200'
                    }`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleWallet(w.id)}
                      />
                      <span className="flex-1">{w.name}</span>
                      <span className="text-xs text-gray-400 font-mono">{w.currency}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {/* Admin-only: shift number + time corrections */}
          {isAdminTier && (
            <>
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-bold text-amber-600 mb-2">للمشرف فقط</p>

                <label className="block text-sm font-medium text-gray-700 mb-1">رقم المناوبة</label>
                <select
                  className="input"
                  value={shiftNumber}
                  onChange={e => setShiftNumber(e.target.value as typeof shiftNumber)}
                >
                  <option value="">— غير محدد —</option>
                  <option value="ONE">{SHIFT_LABEL.ONE}</option>
                  <option value="TWO">{SHIFT_LABEL.TWO}</option>
                  <option value="THREE">{SHIFT_LABEL.THREE}</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">وقت البدء</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={startAt}
                    onChange={e => setStartAt(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    وقت الإغلاق
                    {isOpen && <span className="text-[10px] text-gray-400 ms-1">(فقط للجلسات المغلقة)</span>}
                  </label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={endAt}
                    onChange={e => setEndAt(e.target.value)}
                    disabled={isOpen}
                  />
                </div>
              </div>
              <p className="text-[11px] text-gray-400">
                تعديل التوقيت يُعيد حساب مدة الجلسة تلقائياً وسيُسجَّل في سجل التدقيق.
              </p>
            </>
          )}

          {err && (
            <div className="bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-2 rounded-xl">
              {err}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="btn-secondary btn-sm" disabled={saving}>إلغاء</button>
          <button onClick={handleSave} className="btn-primary btn-sm" disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            حفظ
          </button>
        </div>
      </div>
    </div>
  )
}
