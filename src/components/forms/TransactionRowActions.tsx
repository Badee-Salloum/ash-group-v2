'use client'
import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical, Edit3, Link as LinkIcon, Unlink, Flag, Trash2, X, Save, Loader2 } from 'lucide-react'
import LinkSuggestionsModal from './LinkSuggestionsModal'

// Per-transaction actions menu used on the customer detail page (and any other
// surface that lists transaction rows). Renders a small "⋯" trigger and a
// dropdown of operations, each opening its own modal. The component handles
// API calls, error state, and triggers `onRefresh()` after each successful
// mutation so the parent can re-load the row data.
//
// Permissions are derived from `userRole` — the parent passes the current
// session role. Roles below ACCOUNTANT see no menu at all.

export type TransactionStatus =
  | 'MATCHED' | 'PENDING_SC' | 'PENDING_P' | 'DISCREPANCY' | 'WASTE' | 'RETURNS'

export type ReviewCategory =
  | null
  | 'THEFT' | 'WASTE' | 'EXTRA'
  | 'EMPLOYEE_ERROR' | 'CUSTOMER_ERROR' | 'PLATFORM_ERROR'
  | 'COMPLAINT' | 'INTERNAL_TRANSFER' | 'OTHER'

export interface TransactionRow {
  id: string
  status: TransactionStatus
  type: string
  source: string
  amount: string | number
  currency: string
  matchedTxId?: string | null
  reviewCategory?: ReviewCategory
  reviewNotes?: string | null
  notes?: string | null
}

const STATUS_OPTIONS: Array<{ value: TransactionStatus; label: string }> = [
  { value: 'MATCHED', label: 'مطابقة' },
  { value: 'PENDING_SC', label: 'شام كاش فقط' },
  { value: 'PENDING_P', label: 'المنصة فقط' },
  { value: 'DISCREPANCY', label: 'فارق' },
  { value: 'WASTE', label: 'هدر' },
  { value: 'RETURNS', label: 'مرتجعات' },
]

const CATEGORY_OPTIONS: Array<{ value: Exclude<ReviewCategory, null>; label: string }> = [
  { value: 'THEFT', label: 'سرقة' },
  { value: 'WASTE', label: 'هدر' },
  { value: 'EXTRA', label: 'زيادة' },
  { value: 'EMPLOYEE_ERROR', label: 'خطأ موظف' },
  { value: 'CUSTOMER_ERROR', label: 'خطأ زبون' },
  { value: 'PLATFORM_ERROR', label: 'خطأ منصة' },
  { value: 'COMPLAINT', label: 'شكوى' },
  { value: 'INTERNAL_TRANSFER', label: 'تحويل داخلي (يُستبعد من الربح/الهدر)' },
  { value: 'OTHER', label: 'غير ذلك' },
]

interface Props {
  row: TransactionRow
  userRole: string
  onRefresh: () => void
}

type OpenModal = null | 'edit' | 'link' | 'unlink' | 'followup' | 'delete'

export default function TransactionRowActions({ row, userRole, onRefresh }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [modal, setModal] = useState<OpenModal>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  // Portal coordinates for the dropdown — computed from the trigger's bounding
  // rect so the menu escapes the table's overflow-clip ancestor. Clamped to the
  // viewport on every side: the menu prefers right-aligning with the kebab
  // (natural for RTL), but flips/clamps when the trigger sits near the left or
  // bottom edge so the menu can never extend off-screen.
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  // Visibility rules
  const canEdit = ['ADMIN', 'SUPERVISOR', 'ACCOUNT_MGR'].includes(userRole)
  const canUnlink = ['ADMIN', 'SUPERVISOR'].includes(userRole)
  const canDelete = userRole === 'ADMIN'
  const hasMenu = canEdit || canUnlink || canDelete

  // Recompute coords whenever the menu opens; close on scroll/resize so a
  // stale position never lingers (the table itself scrolls horizontally).
  useLayoutEffect(() => {
    if (!menuOpen || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    // Approx menu footprint — the dropdown is min-w-[180px] and roughly
    // 36px per item × up to 5 items + 4px border/padding.
    const MENU_WIDTH = 200
    const MENU_HEIGHT = 5 * 36 + 8
    const VIEWPORT_PAD = 8
    // Horizontal: prefer right-aligning with the trigger (RTL-natural).
    // Clamp so the menu always stays inside [VIEWPORT_PAD, viewport - VIEWPORT_PAD].
    const preferredLeft = rect.right - MENU_WIDTH
    const maxLeft = window.innerWidth - MENU_WIDTH - VIEWPORT_PAD
    const left = Math.max(VIEWPORT_PAD, Math.min(preferredLeft, maxLeft))
    // Vertical: open downward by default; flip up if it would overflow the
    // bottom edge AND there's more room above the trigger.
    const preferredTop = rect.bottom + 4
    const overflowsBottom = preferredTop + MENU_HEIGHT > window.innerHeight - VIEWPORT_PAD
    const top = overflowsBottom && rect.top > MENU_HEIGHT + VIEWPORT_PAD
      ? rect.top - MENU_HEIGHT - 4
      : Math.min(preferredTop, window.innerHeight - MENU_HEIGHT - VIEWPORT_PAD)
    setCoords({ top: Math.max(VIEWPORT_PAD, top), left })
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    function onScrollOrResize() { setMenuOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [menuOpen])

  if (!hasMenu) return null

  const open = (m: OpenModal) => {
    setMenuOpen(false)
    setModal(m)
  }

  // Only PENDING_SC / PENDING_P rows can be linked via suggest-match. Hiding
  // the menu item for MATCHED/DISCREPANCY/WASTE/RETURNS avoids opening a
  // modal that would immediately 400 from the suggest-match endpoint.
  const isLinkable = row.status === 'PENDING_SC' || row.status === 'PENDING_P'
  const isLinked = row.status === 'MATCHED' || row.status === 'DISCREPANCY'

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setMenuOpen(o => !o)}
        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
        aria-label="إجراءات"
      >
        <MoreVertical size={16} />
      </button>
      {menuOpen && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[180px] bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
          style={{ top: coords.top, left: coords.left }}
        >
          {canEdit && (
            <MenuItem icon={<Edit3 size={14} />} onClick={() => open('edit')}>
              تعديل الحالة / الفئة / الملاحظات
            </MenuItem>
          )}
          {canEdit && isLinkable && (
            <MenuItem icon={<LinkIcon size={14} />} onClick={() => open('link')}>
              ربط مع عملية أخرى
            </MenuItem>
          )}
          {canUnlink && isLinked && (
            <MenuItem icon={<Unlink size={14} />} onClick={() => open('unlink')}>
              فك الربط
            </MenuItem>
          )}
          {canEdit && (
            <MenuItem icon={<Flag size={14} />} onClick={() => open('followup')}>
              فتح / إسناد متابعة
            </MenuItem>
          )}
          {canDelete && (
            <MenuItem
              icon={<Trash2 size={14} />}
              onClick={() => open('delete')}
              danger
            >
              حذف
            </MenuItem>
          )}
        </div>,
        document.body
      )}

      {modal === 'edit' && (
        <EditTransactionModal row={row} onClose={() => setModal(null)} onSaved={onRefresh} />
      )}
      {modal === 'link' && (
        <LinkSuggestionsModal
          transactionId={row.id}
          open={true}
          onClose={() => setModal(null)}
          onResolved={onRefresh}
        />
      )}
      {modal === 'unlink' && (
        <ConfirmUnlinkModal row={row} onClose={() => setModal(null)} onSaved={onRefresh} />
      )}
      {modal === 'followup' && (
        <FollowupModal row={row} onClose={() => setModal(null)} onSaved={onRefresh} />
      )}
      {modal === 'delete' && (
        <ConfirmDeleteModal row={row} onClose={() => setModal(null)} onSaved={onRefresh} />
      )}
    </>
  )
}

// ─── shared bits ────────────────────────────────────────────────────────────

function MenuItem({ icon, children, onClick, danger }: {
  icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-right px-3 py-2 text-sm flex items-center gap-2 transition-colors
        ${danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  // CRITICAL: render the backdrop via a portal to document.body. The modals
  // are spawned from rows inside <td> cells, and browsers apply layout
  // quirks to fixed-positioned descendants of table cells (the containing
  // block ends up being the table, not the viewport, so `fixed inset-0`
  // only covers the row's visible area). Portaling lifts the whole overlay
  // out of the table tree so `fixed inset-0` reliably means "the viewport".
  //
  // Page-scroll pattern: the backdrop itself scrolls; the modal grows
  // naturally inside. min-h-full + items-center centers when content fits,
  // and pushes the modal down with a scrollbar when it doesn't.
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-md overflow-y-auto"
      onClick={onClose}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div
          className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 w-full max-w-md my-auto"
          onClick={e => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b">
      <h3 className="font-bold text-slate-800">{title}</h3>
      <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
        <X size={18} />
      </button>
    </div>
  )
}

function SubmitButton({ saving, label }: { saving: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={saving}
      className="w-full py-2.5 rounded-xl font-semibold text-white text-sm
        bg-gradient-to-r from-[#0a2540] to-[#0c3d6e]
        hover:from-[#0c3050] hover:to-[#0e4a82]
        disabled:opacity-50 transition-colors
        flex items-center justify-center gap-2"
    >
      {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
      <span>{label}</span>
    </button>
  )
}

function ErrorBox({ error }: { error: string }) {
  if (!error) return null
  return (
    <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-3 py-2 rounded-lg">
      {error}
    </div>
  )
}

// ─── modals ─────────────────────────────────────────────────────────────────

function EditTransactionModal({ row, onClose, onSaved }: { row: TransactionRow; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<TransactionStatus>(row.status)
  const [category, setCategory] = useState<ReviewCategory>(row.reviewCategory ?? null)
  const [reviewNotes, setReviewNotes] = useState(row.reviewNotes || '')
  const [notes, setNotes] = useState(row.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      const res = await fetch('/api/transactions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: row.id,
          status,
          // Explicit null clears a previously set category. The PUT endpoint
          // also auto-closes the follow-up when leaving a COMPLAINT/_ERROR
          // category.
          reviewCategory: category,
          reviewNotes: reviewNotes || null,
          notes: notes || null,
        }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'تعذّر الحفظ')
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Backdrop onClose={onClose}>
      <ModalHeader title="تعديل العملية" onClose={onClose} />
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">الحالة</label>
          <select
            value={status}
            onChange={e => setStatus(e.target.value as TransactionStatus)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">
            فئة المراجعة
            {row.reviewCategory && (
              <span className="text-amber-600 font-normal ms-2">
                (مُعيَّنة سابقاً — يمكن تغييرها أو إزالتها)
              </span>
            )}
          </label>
          <select
            value={category ?? ''}
            onChange={e => setCategory(e.target.value === '' ? null : (e.target.value as Exclude<ReviewCategory, null>))}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option value="">— بدون فئة —</option>
            {CATEGORY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">ملاحظات المراجعة</label>
          <textarea
            value={reviewNotes}
            onChange={e => setReviewNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="سبب الاختيار، أي تفاصيل…"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">ملاحظات عامة</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>

        <ErrorBox error={error} />
        <SubmitButton saving={saving} label="حفظ التعديلات" />
      </form>
    </Backdrop>
  )
}

function ConfirmUnlinkModal({ row, onClose, onSaved }: { row: TransactionRow; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    setError(''); setSaving(true)
    try {
      const res = await fetch('/api/reconciliation/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: row.id }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'تعذّر فك الربط')
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Backdrop onClose={onClose}>
      <ModalHeader title="فك الربط" onClose={onClose} />
      <div className="p-5 space-y-4">
        <p className="text-sm text-gray-700 leading-relaxed">
          سيتم إرجاع العمليتين إلى حالة الانتظار (PENDING). هذا الإجراء يُسجَّل
          في سجل التدقيق ولا يمكن التراجع عنه تلقائياً.
        </p>
        <ErrorBox error={error} />
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm border border-gray-200 hover:bg-gray-50"
          >
            إلغاء
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Unlink size={16} />}
            <span>تأكيد فك الربط</span>
          </button>
        </div>
      </div>
    </Backdrop>
  )
}

function FollowupModal({ row, onClose, onSaved }: { row: TransactionRow; onClose: () => void; onSaved: () => void }) {
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [assigneeId, setAssigneeId] = useState('')
  const [status, setStatus] = useState<'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'>('OPEN')
  const [resolution, setResolution] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/employees')
      .then(r => r.json())
      .then(d => {
        if (d.success) setUsers(d.data || [])
      })
      .catch(() => undefined)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      // Open or update follow-up. The PATCH endpoint accepts transactionId.
      const res = await fetch(`/api/follow-ups/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          followUpStatus: status,
          followUpAssignedTo: assigneeId || null,
          followUpResolution: resolution || null,
        }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'تعذّر تحديث المتابعة')
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Backdrop onClose={onClose}>
      <ModalHeader title="إدارة المتابعة" onClose={onClose} />
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">حالة المتابعة</label>
          <select
            value={status}
            onChange={e => setStatus(e.target.value as typeof status)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option value="OPEN">مفتوحة</option>
            <option value="IN_PROGRESS">قيد المعالجة</option>
            <option value="RESOLVED">تم الحل</option>
            <option value="CLOSED">مغلقة بلا حل</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">المسؤول</label>
          <select
            value={assigneeId}
            onChange={e => setAssigneeId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option value="">— بدون إسناد —</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>

        {(status === 'RESOLVED' || status === 'CLOSED') && (
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">ملاحظات الإغلاق</label>
            <textarea
              value={resolution}
              onChange={e => setResolution(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="وصف الحل المُتَّخذ…"
            />
          </div>
        )}

        <ErrorBox error={error} />
        <SubmitButton saving={saving} label="حفظ" />
      </form>
    </Backdrop>
  )
}

function ConfirmDeleteModal({ row, onClose, onSaved }: { row: TransactionRow; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmText, setConfirmText] = useState('')

  async function handleConfirm() {
    if (confirmText !== 'حذف') {
      setError('اكتب كلمة "حذف" لتأكيد العملية')
      return
    }
    setError(''); setSaving(true)
    try {
      const res = await fetch(`/api/transactions?id=${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'تعذّر الحذف')
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Backdrop onClose={onClose}>
      <ModalHeader title="حذف العملية" onClose={onClose} />
      <div className="p-5 space-y-4">
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2.5 rounded-lg leading-relaxed">
          <strong>تحذير:</strong> هذا الإجراء يحذف العملية نهائياً من قاعدة البيانات
          ولا يمكن التراجع عنه. تُسجَّل عملية الحذف في سجل التدقيق.
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">
            اكتب كلمة <strong>حذف</strong> للتأكيد:
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30"
            placeholder="حذف"
            autoFocus
          />
        </div>
        <ErrorBox error={error} />
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm border border-gray-200 hover:bg-gray-50"
          >
            إلغاء
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || confirmText !== 'حذف'}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            <span>تأكيد الحذف</span>
          </button>
        </div>
      </div>
    </Backdrop>
  )
}
