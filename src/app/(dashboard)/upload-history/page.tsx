'use client'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { fmtSyria } from '@/lib/datetime'
import { Trash2, ChevronDown, ChevronUp, Calendar } from 'lucide-react'
import { Transaction } from '../reconciliation/_components/types'
import { BatchPanel } from './_components/BatchPanel'
import { useToast } from '@/components/ui/Toast'
import type { UploadSort } from '@/lib/uploads/sort'
import { UploadAttempts } from '@/components/forms/UploadAttempts'

interface Batch {
  id: string
  accountName: string
  uploaderName: string
  batchDate: string
  status: string
  rowsProcessed: number
  errorLog: string | null
  processedAt: string | null
  createdAt: string
  // Aggregate fields from /api/upload-batches GET — added so the list row
  // can show the transaction-date range the batch covers without a
  // per-batch follow-up query.
  txDateFrom: string | null
  txDateTo: string | null
  txCount: number
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  COMPLETED:  { label: 'مكتمل',  cls: 'badge-matched' },
  PROCESSING: { label: 'معالجة', cls: 'badge-pending-sc' },
  FAILED:     { label: 'فشل',   cls: 'badge-discrepancy' },
}

export default function UploadHistoryPage() {
  const searchParams = useSearchParams()
  // Deep-link target: /upload-history?batch=<id> opens straight on that batch.
  const requestedBatchId = searchParams?.get('batch') || null
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<UploadSort>({ key: 'createdAt', direction: 'desc' })
  const [loadError, setLoadError] = useState('')
  const listAbortRef = useRef<AbortController | null>(null)
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 })
  const [expandedError, setExpandedError] = useState<string | null>(null)
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(requestedBatchId)
  const [batchTxs, setBatchTxs] = useState<Record<string, Transaction[]>>({})
  const [loadingBatchId, setLoadingBatchId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [userRole, setUserRole] = useState<string>('')
  const toast = useToast()
  // Held across renders so the Cancel button in the confirm strip can abort
  // the in-flight fetch instead of just hiding the UI while the server
  // keeps deleting.
  const deleteAbortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (page = 1) => {
    listAbortRef.current?.abort()
    const controller = new AbortController()
    listAbortRef.current = controller
    setLoading(true)
    setLoadError('')
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: '25', sortBy: sort.key, sortDir: sort.direction })
      const res = await fetch(`/api/upload-batches?${query}`, { signal: controller.signal, cache: 'no-store' })
      const d = await res.json()
      if (!res.ok || !d.success) throw new Error(d.error || 'تعذر تحميل سجل الرفع')
      if (controller.signal.aborted) return
      setBatches(d.data)
      setMeta(d.meta)
    } catch (error) {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'تعذر تحميل سجل الرفع')
    } finally {
      if (listAbortRef.current === controller) setLoading(false)
    }
  }, [sort])

  useEffect(() => { void load(); return () => listAbortRef.current?.abort() }, [load])

  function changeSort(key: UploadSort['key']) {
    setSort(previous => ({ key, direction: previous.key === key && previous.direction === 'asc' ? 'desc' : 'asc' }))
  }

  function sortHeader(key: UploadSort['key'], label: string) {
    return <th aria-sort={sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => changeSort(key)} className="inline-flex items-center gap-1 hover:text-brand-600"
        title="اضغط للتبديل بين الترتيب التصاعدي والتنازلي">
        {label}
        {sort.key === key && (sort.direction === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
      </button>
    </th>
  }

  // Role drives the "بدّل الملف" buttons inside the expansion panel — same
  // gating the existing DELETE-batch action uses (ADMIN / SUPERVISOR).
  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(d => { if (d?.role) setUserRole(d.role) })
      .catch(() => undefined)
  }, [])

  const canReplace = userRole === 'ADMIN' || userRole === 'SUPERVISOR'

  const fetchBatchTxs = useCallback(async (batchId: string) => {
    setLoadingBatchId(batchId)
    try {
      const res = await fetch(`/api/transactions?batchId=${batchId}&pageSize=10000`)
      const d = await res.json()
      if (d.success) {
        setBatchTxs(prev => ({ ...prev, [batchId]: d.data as Transaction[] }))
      }
    } finally {
      setLoadingBatchId(null)
    }
  }, [])

  // If we arrived via /upload-history?batch=<id>, eagerly fetch that batch's
  // transactions so the panel renders content even when the row itself is on
  // a later page. (We don't try to jump pagination yet — that's a separate
  // affordance; the user can still scroll to find it visually.)
  useEffect(() => {
    if (requestedBatchId && !batchTxs[requestedBatchId]) {
      void fetchBatchTxs(requestedBatchId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedBatchId, fetchBatchTxs])

  function toggleExpand(batchId: string) {
    if (expandedBatchId === batchId) {
      setExpandedBatchId(null)
    } else {
      setExpandedBatchId(batchId)
      if (!batchTxs[batchId]) void fetchBatchTxs(batchId)
    }
  }

  async function handleDelete(batchId: string) {
    setDeleting(true)
    // 65s > server maxDuration=60s gives enough slack for the response bytes
    // to hit the client before the timer aborts. A tie between the two would
    // occasionally abort a delete that actually succeeded, and the user's
    // retry would then see 404 "الدفعة غير موجودة".
    const controller = new AbortController()
    deleteAbortRef.current = controller
    // Tag user-initiated cancel vs timeout so the toast is accurate.
    let cancelledByUser = false
    const originalAbort = controller.abort.bind(controller)
    controller.abort = () => { cancelledByUser = true; originalAbort() }
    const timer = setTimeout(() => { cancelledByUser = false; originalAbort() }, 65_000)
    try {
      const res = await fetch(`/api/upload-batches?id=${batchId}`, {
        method: 'DELETE',
        signal: controller.signal,
      })
      // Vercel's platform errors (FUNCTION_INVOCATION_TIMEOUT etc.) come back
      // as an HTML page — res.json() would throw SyntaxError with a cryptic
      // "Unexpected token 'A'". Detect and translate to a real message first.
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('application/json')) {
        toast(`خطأ في الخادم (${res.status}) — أعد المحاولة`, 'error')
        return
      }
      const d = await res.json()
      if (d.success) {
        setDeleteConfirm(null)
        // Drop the cached rows for the deleted batch so a re-expand re-fetches.
        setBatchTxs(prev => {
          const next = { ...prev }
          delete next[batchId]
          return next
        })
        toast(d.message || 'تم حذف الدفعة', 'success')
        load(meta.page)
      } else {
        toast(d.error || 'تعذّر حذف الدفعة', 'error')
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        toast(cancelledByUser ? 'تم إلغاء الحذف' : 'انتهت مهلة الحذف — أعد المحاولة', 'error')
      } else {
        toast(e instanceof Error ? e.message : 'خطأ في الاتصال', 'error')
      }
    } finally {
      clearTimeout(timer)
      deleteAbortRef.current = null
      setDeleting(false)
    }
  }

  // Called by the Cancel button in the confirm strip. If a fetch is in-flight,
  // abort it (server may have already committed — that's out of our hands but
  // the toast makes clear the click was received). Always collapses the strip.
  function cancelDelete() {
    deleteAbortRef.current?.abort()
    setDeleteConfirm(null)
  }

  // BatchPanel calls this after edits / deletions / file replacements so the
  // expansion refreshes immediately and the batch list aggregate stays fresh.
  function refreshExpanded(batchId: string) {
    void fetchBatchTxs(batchId)
    void load(meta.page)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">سجل الرفع</h1>
        <p className="text-sm text-gray-500 mt-0.5">Upload History — إجمالي: {meta.total.toLocaleString('ar')} عملية رفع</p>
        {loading && batches.length > 0 && <p role="status" className="text-xs text-gray-400 mt-1">جارٍ تحديث الترتيب…</p>}
      </div>

      {['ADMIN', 'SUPERVISOR'].includes(userRole) && <UploadAttempts />}
      {loadError && <div role="alert" className="card border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 flex items-center justify-between gap-3">
        <span>{loadError}</span>
        <button className="btn-secondary btn-sm" onClick={() => void load(meta.page)}>إعادة المحاولة</button>
      </div>}

      <div className="card">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                {sortHeader('createdAt', 'تاريخ الرفع')}
                {sortHeader('accountName', 'الحساب')}
                {sortHeader('uploaderName', 'المستخدم')}
                {sortHeader('status', 'الحالة')}
                {sortHeader('rowsProcessed', 'الصفوف المعالجة')}
                {sortHeader('processedAt', 'وقت المعالجة')}
                {sortHeader('errorLog', 'ملاحظات')}
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {loading && batches.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">جاري التحميل...</td></tr>
              ) : !batches.length ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">لا توجد عمليات رفع</td></tr>
              ) : batches.map(b => {
                const isOpen = expandedBatchId === b.id
                const rows = batchTxs[b.id] || []
                return (
                  <React.Fragment key={b.id}>
                    <tr>
                      <td>
                        <button
                          onClick={() => toggleExpand(b.id)}
                          className="text-gray-400 hover:text-brand-600 p-1 rounded hover:bg-brand-50 transition-colors"
                          title={isOpen ? 'إخفاء العمليات' : 'عرض العمليات داخل هذه الدفعة'}
                          aria-label="عرض العمليات"
                        >
                          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </td>
                      <td className="text-sm font-mono">
                        <div className="space-y-1">
                          <div>{fmtSyria(b.createdAt, false)}</div>
                          {(b.txDateFrom || b.txDateTo) ? (
                            <div
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-100 ring-1 ring-slate-200 rounded px-1.5 py-0.5"
                              title={`الفترة التي تغطيها العمليات داخل الملفات (${b.txCount} عملية)`}
                            >
                              <Calendar size={10} />
                              {b.txDateFrom && b.txDateTo && b.txDateFrom.slice(0, 10) === b.txDateTo.slice(0, 10)
                                ? fmtSyria(b.txDateFrom, false)
                                : <>
                                    {fmtSyria(b.txDateFrom || b.txDateTo!, false)}
                                    <span className="text-slate-400">←</span>
                                    {fmtSyria(b.txDateTo || b.txDateFrom!, false)}
                                  </>
                              }
                            </div>
                          ) : (
                            <div className="text-[10px] text-slate-400">— لا توجد عمليات —</div>
                          )}
                        </div>
                      </td>
                      <td className="font-medium">{b.accountName}</td>
                      <td className="text-sm text-gray-600">{b.uploaderName}</td>
                      <td>
                        <span className={`badge ${STATUS_MAP[b.status]?.cls || 'badge-pending-sc'}`}>
                          {STATUS_MAP[b.status]?.label || b.status}
                        </span>
                      </td>
                      <td className="font-mono">{b.rowsProcessed.toLocaleString('ar')}</td>
                      <td className="text-sm text-gray-500">
                        {b.processedAt ? fmtSyria(b.processedAt).split(' ')[1] : '—'}
                      </td>
                      <td>
                        {b.errorLog ? (
                          <button
                            className="text-red-600 text-xs underline"
                            onClick={() => setExpandedError(expandedError === b.id ? null : b.id)}
                          >
                            {expandedError === b.id ? 'إخفاء' : 'عرض الأخطاء'}
                          </button>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                        {expandedError === b.id && b.errorLog && (
                          <pre className="mt-2 text-xs bg-red-50 text-red-800 p-2 rounded max-w-md overflow-auto max-h-32">{b.errorLog}</pre>
                        )}
                      </td>
                      <td>
                        {deleteConfirm === b.id ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleDelete(b.id)}
                              disabled={deleting}
                              className="btn-danger btn-sm"
                            >
                              {deleting ? 'جاري الحذف...' : 'تأكيد'}
                            </button>
                            <button
                              onClick={cancelDelete}
                              className="btn-secondary btn-sm"
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(b.id)}
                            className="text-red-400 hover:text-red-600 transition-colors p-1 rounded hover:bg-red-50"
                            title="حذف الدفعة وجميع عملياتها"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={9} className="bg-slate-50/60 border-t border-b border-slate-200 p-0">
                          <BatchPanel
                            batchId={b.id}
                            rows={rows}
                            loading={loadingBatchId === b.id}
                            canReplace={canReplace}
                            onRefresh={() => refreshExpanded(b.id)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {meta.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 py-4 border-t">
            <button
              className="btn-secondary btn-sm"
              disabled={loading || meta.page <= 1}
              onClick={() => load(meta.page - 1)}
            >
              السابق
            </button>
            <span className="text-sm text-gray-500">
              {meta.page} / {meta.totalPages}
            </span>
            <button
              className="btn-secondary btn-sm"
              disabled={loading || meta.page >= meta.totalPages}
              onClick={() => load(meta.page + 1)}
            >
              التالي
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
