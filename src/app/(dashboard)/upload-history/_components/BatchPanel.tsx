'use client'
import { TransactionQueryTable } from '@/components/tables/TransactionQueryTable'
import { useMemo, useRef, useState } from 'react'
import {
  Loader2, Pencil, Trash2, ArrowDownToLine, ArrowUpFromLine,
  FileSpreadsheet, Replace,
} from 'lucide-react'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { EditModal } from '../../reconciliation/_components/EditModal'
import {
  Transaction, TxStatus,
  STATUS_LABELS,
} from '../../reconciliation/_components/types'

export type ReplaceFileType = 'shamCash' | 'deposits' | 'withdrawals'
type SourceTab = 'all' | 'sc' | 'dep' | 'wd'

interface ReplaceStats {
  fileType: ReplaceFileType
  updated: number
  inserted: number
  removed: number
  unlinked: number
  newMatches: number
}

interface Props {
  batchId: string
  rows: Transaction[]
  loading: boolean
  canReplace: boolean
  onRefresh: () => void
}

const FILE_TYPE_LABEL: Record<ReplaceFileType, string> = {
  shamCash: 'ملف شام كاش',
  deposits: 'ملف الإيداعات',
  withdrawals: 'ملف السحوبات',
}

export function BatchPanel({ batchId, rows, loading, canReplace, onRefresh }: Props) {
  const [tab, setTab] = useState<SourceTab>('all')
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [uploading, setUploading] = useState<ReplaceFileType | null>(null)
  const confirm = useConfirm()
  const toast = useToast()

  // Hidden file inputs — one per file type so the picker remembers its source.
  const scInputRef = useRef<HTMLInputElement | null>(null)
  const depInputRef = useRef<HTMLInputElement | null>(null)
  const wdInputRef = useRef<HTMLInputElement | null>(null)

  const counts = useMemo(() => {
    let sc = 0, dep = 0, wd = 0
    for (const t of rows) {
      if (t.source === 'SHAM_CASH') sc++
      else if (t.type === 'DEPOSIT') dep++
      else if (t.type === 'WITHDRAWAL') wd++
    }
    return { sc, dep, wd, total: rows.length }
  }, [rows])

  const statusCounts = useMemo(() => {
    const m: Partial<Record<TxStatus, number>> = {}
    for (const t of rows) m[t.status] = (m[t.status] || 0) + 1
    return m
  }, [rows])

  const currencyTotals = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of rows) {
      const cur = t.currency || 'USD'
      m[cur] = (m[cur] || 0) + Number(t.amount || 0)
    }
    return m
  }, [rows])

  async function handleReplaceFile(fileType: ReplaceFileType, file: File) {
    setUploading(fileType)
    try {
      const fd = new FormData()
      fd.append('fileType', fileType)
      fd.append('file', file)
      const r = await fetch(`/api/upload-batches/${batchId}/replace-file`, {
        method: 'POST',
        body: fd,
      })
      const d = await r.json()
      if (!d.success) {
        // Backend rejected an empty replacement — surface a confirm + retry.
        if (d.requireConfirmEmpty && await confirm(d.error || 'الملف فارغ — هل تريد المتابعة بحذف عمليات هذا المصدر؟')) {
          const fd2 = new FormData()
          fd2.append('fileType', fileType)
          fd2.append('file', file)
          const r2 = await fetch(`/api/upload-batches/${batchId}/replace-file?confirmEmpty=true`, {
            method: 'POST',
            body: fd2,
          })
          const d2 = await r2.json()
          if (!d2.success) {
            toast(d2.error || 'تعذّر استبدال الملف', 'error')
            return
          }
          announceReplaceStats(d2.stats as ReplaceStats, toast)
          onRefresh()
          return
        }
        toast(d.error || 'تعذّر استبدال الملف', 'error')
        return
      }
      announceReplaceStats(d.stats as ReplaceStats, toast)
      onRefresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذّر استبدال الملف', 'error')
    } finally {
      setUploading(null)
    }
  }

  async function handleDeleteRow(txId: string) {
    if (!(await confirm('حذف هذا الصف فقط (دون باقي الدفعة)؟ سيُلغى ربطه إن وُجد.'))) return
    const r = await fetch(`/api/transactions?id=${txId}`, { method: 'DELETE' })
    const d = await r.json()
    if (d.success) {
      toast('تم حذف الصف', 'success')
      onRefresh()
    } else {
      toast(d.error || 'تعذّر الحذف', 'error')
    }
  }

  function pickFile(t: ReplaceFileType) {
    if (uploading) return
    const ref = t === 'shamCash' ? scInputRef : t === 'deposits' ? depInputRef : wdInputRef
    ref.current?.click()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
        <Loader2 size={14} className="animate-spin" /> جاري تحميل عمليات الدفعة…
      </div>
    )
  }
  if (!rows.length) {
    return (
      <div className="text-center text-sm text-gray-400 py-10">
        لا توجد عمليات في هذه الدفعة (قد تكون حُذفت سابقاً)
      </div>
    )
  }

  return (
    <div className="p-3 space-y-3">
      {/* Hidden file pickers for each replace button */}
      <input
        ref={scInputRef} type="file" hidden accept=".xlsx,.xls,.csv"
        onChange={e => { const f = e.target.files?.[0]; if (f) { void handleReplaceFile('shamCash', f); e.target.value = '' } }}
      />
      <input
        ref={depInputRef} type="file" hidden accept=".xlsx,.xls,.csv"
        onChange={e => { const f = e.target.files?.[0]; if (f) { void handleReplaceFile('deposits', f); e.target.value = '' } }}
      />
      <input
        ref={wdInputRef} type="file" hidden accept=".xlsx,.xls,.csv"
        onChange={e => { const f = e.target.files?.[0]; if (f) { void handleReplaceFile('withdrawals', f); e.target.value = '' } }}
      />

      {/* Tiles + replace actions row */}
      <p className="text-[10px] text-gray-400">البطاقات تلخّص عيّنة محمّلة؛ جدول العمليات يبحث ويرتّب كامل الرفعة.</p>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Tile icon={<FileSpreadsheet size={14} />} label="شام كاش" count={counts.sc} tone="amber" />
          <Tile icon={<ArrowDownToLine size={14} />} label="إيداعات" count={counts.dep} tone="emerald" />
          <Tile icon={<ArrowUpFromLine size={14} />} label="سحوبات" count={counts.wd} tone="sky" />
        </div>
        {canReplace && (
          <div className="flex items-center gap-2 flex-wrap">
            <ReplaceButton type="shamCash" busy={uploading === 'shamCash'} disabled={!!uploading} onClick={() => pickFile('shamCash')} />
            <ReplaceButton type="deposits" busy={uploading === 'deposits'} disabled={!!uploading} onClick={() => pickFile('deposits')} />
            <ReplaceButton type="withdrawals" busy={uploading === 'withdrawals'} disabled={!!uploading} onClick={() => pickFile('withdrawals')} />
          </div>
        )}
      </div>

      {/* Status breakdown + currency totals */}
      <div className="flex items-center gap-2 flex-wrap text-xs text-gray-600">
        {Object.keys(statusCounts).length > 0 && (
          <>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">حالات:</span>
            {(Object.entries(statusCounts) as [TxStatus, number][]).map(([k, n]) => {
              const s = STATUS_LABELS[k]
              if (!s) return null
              return (
                <span key={k} className={`badge ${s.cls}`}>
                  {s.label} <span className="font-mono ms-1">{n}</span>
                </span>
              )
            })}
          </>
        )}
        {Object.keys(currencyTotals).length > 0 && (
          <>
            <span className="mx-2 text-gray-300">·</span>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">مجاميع:</span>
            {Object.entries(currencyTotals).map(([cur, total]) => (
              <span key={cur} className="font-mono text-gray-700 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5">
                {total.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {cur}
              </span>
            ))}
          </>
        )}
      </div>

      {/* Tabs + search */}
      <div className="flex items-center gap-2 flex-wrap">
        <TabBtn active={tab === 'all'} onClick={() => setTab('all')}>الكل ({counts.total})</TabBtn>
        <TabBtn active={tab === 'sc'} onClick={() => setTab('sc')}>شام كاش ({counts.sc})</TabBtn>
        <TabBtn active={tab === 'dep'} onClick={() => setTab('dep')}>إيداعات ({counts.dep})</TabBtn>
        <TabBtn active={tab === 'wd'} onClick={() => setTab('wd')}>سحوبات ({counts.wd})</TabBtn>
        <div className="flex-1 min-w-[120px]" />

      </div>

      {/* Sorting and pagination cover the whole batch, not the loaded summary sample. */}
      <TransactionQueryTable key={batchId + tab} refreshKey={rows} query={new URLSearchParams({
        batchId, ...(tab === 'sc' ? { source: 'SHAM_CASH' } : tab === 'all' ? {} : { source: 'PLATFORM', type: tab === 'dep' ? 'DEPOSIT' : 'WITHDRAWAL' }),
      }).toString()} renderActions={row => <div className="flex items-center gap-1">
        <button onClick={() => setEditTx(row as unknown as Transaction)} className="btn-ghost btn-sm" title="تعديل الصف"><Pencil size={13} /></button>
        <button onClick={() => void handleDeleteRow(row.id)} className="btn-ghost btn-sm text-red-600" title="حذف هذا الصف فقط"><Trash2 size={13} /></button>
      </div>} />

      {editTx && (
        <EditModal
          tx={editTx}
          onClose={() => setEditTx(null)}
          onSaved={() => { setEditTx(null); onRefresh() }}
        />
      )}
    </div>
  )
}

// ───── sub-pieces ────────────────────────────────────────────────────────────

function Tile({ icon, label, count, tone }: {
  icon: React.ReactNode; label: string; count: number;
  tone: 'amber' | 'emerald' | 'sky'
}) {
  const cls = {
    amber:   'bg-amber-50 text-amber-700 border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    sky:     'bg-sky-50 text-sky-700 border-sky-200',
  }[tone]
  return (
    <div className={`rounded-lg border px-3 py-1.5 flex items-center gap-2 ${cls}`}>
      <span className="opacity-70">{icon}</span>
      <span className="text-[11px] font-semibold">{label}</span>
      <span className="font-mono font-bold text-sm">{count}</span>
    </div>
  )
}

function TabBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-lg ring-1 transition-colors font-medium ${
        active
          ? 'bg-brand-100 text-brand-800 ring-brand-300'
          : 'bg-white text-gray-600 ring-gray-200 hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200'
      }`}
    >
      {children}
    </button>
  )
}

function ReplaceButton({ type, busy, disabled, onClick }: {
  type: ReplaceFileType
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled && !busy}
      className="btn-secondary btn-sm"
      title={`استبدل ${FILE_TYPE_LABEL[type]} بملف جديد — تبقى المطابقات على الصفوف التي لا تزال موجودة`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Replace size={13} />}
      <span>بدّل {FILE_TYPE_LABEL[type]}</span>
    </button>
  )
}

function announceReplaceStats(stats: ReplaceStats, toast: ReturnType<typeof useToast>) {
  const parts: string[] = []
  if (stats.inserted) parts.push(`أُضيف ${stats.inserted}`)
  if (stats.updated) parts.push(`حُدِّث ${stats.updated}`)
  if (stats.removed) parts.push(`حُذف ${stats.removed}`)
  if (stats.unlinked) parts.push(`فُكَّ ربط ${stats.unlinked}`)
  if (stats.newMatches) parts.push(`مطابقات جديدة ${stats.newMatches}`)
  const msg = parts.length
    ? `تم استبدال ${FILE_TYPE_LABEL[stats.fileType]} — ${parts.join('، ')}`
    : `تم استبدال ${FILE_TYPE_LABEL[stats.fileType]} (لا تغييرات)`
  toast(msg, 'success')
}
