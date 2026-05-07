'use client'
import { useEffect, useState, useCallback } from 'react'
import { fmtSyria } from '@/lib/datetime'
import { Trash2, AlertTriangle } from 'lucide-react'

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
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  COMPLETED:  { label: 'مكتمل',  cls: 'badge-matched' },
  PROCESSING: { label: 'معالجة', cls: 'badge-pending-sc' },
  FAILED:     { label: 'فشل',   cls: 'badge-discrepancy' },
}

export default function UploadHistoryPage() {
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 })
  const [expandedError, setExpandedError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async (page = 1) => {
    setLoading(true)
    const res = await fetch(`/api/upload-batches?page=${page}&pageSize=25`)
    const d = await res.json()
    if (d.success) {
      setBatches(d.data)
      setMeta(d.meta)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleDelete(batchId: string) {
    setDeleting(true)
    try {
      const res = await fetch(`/api/upload-batches?id=${batchId}`, { method: 'DELETE' })
      const d = await res.json()
      if (d.success) {
        setDeleteConfirm(null)
        load(meta.page)
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">سجل الرفع</h1>
        <p className="text-sm text-gray-500 mt-0.5">Upload History — إجمالي: {meta.total.toLocaleString('ar')} عملية رفع</p>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>تاريخ الرفع</th>
                <th>الحساب</th>
                <th>المستخدم</th>
                <th>الحالة</th>
                <th>الصفوف المعالجة</th>
                <th>وقت المعالجة</th>
                <th>ملاحظات</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">جاري التحميل...</td></tr>
              ) : !batches.length ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">لا توجد عمليات رفع</td></tr>
              ) : batches.map(b => (
                <tr key={b.id}>
                  <td className="text-sm font-mono">{fmtSyria(b.createdAt, false)}</td>
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
                          onClick={() => setDeleteConfirm(null)}
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
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {meta.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 py-4 border-t">
            <button
              className="btn-secondary btn-sm"
              disabled={meta.page <= 1}
              onClick={() => load(meta.page - 1)}
            >
              السابق
            </button>
            <span className="text-sm text-gray-500">
              {meta.page} / {meta.totalPages}
            </span>
            <button
              className="btn-secondary btn-sm"
              disabled={meta.page >= meta.totalPages}
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
