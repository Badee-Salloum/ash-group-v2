'use client'
import { useEffect, useState } from 'react'
import { fmtSyria } from '@/lib/datetime'

type Attempt = { id: string; startedAt: string; completedAt?: string; stageLabel: string; status: string;
  actorType: string; authMethod: string; actorUserId?: string; actorName?: string; batchId?: string; warning?: string; failedStageLabel?: string; elapsedMs?: number }
export function UploadAttempts() {
  const [rows, setRows] = useState<Attempt[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetch('/api/upload/attempts', { signal: controller.signal, cache: 'no-store' }).then(async r => {
      const data = await r.json()
      if (!r.ok) throw new Error('تعذر تحميل المحاولات')
      setRows(data.data); setError('')
    }).catch(() => { if (!controller.signal.aborted) setError('تعذر تحميل المحاولات') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [refresh])
  return <section className="card p-4 space-y-2">
    <div className="flex justify-between"><h2 className="font-semibold">محاولات الرفع الأخيرة</h2>
      <button type="button" onClick={() => setRefresh(v => v + 1)}>تحديث</button></div>
    <p className="text-xs text-gray-500">تتضمن فشل القراءة وانقطاع المعالجة. لا تعاود الرفع قبل التحقق من المحاولة.</p>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status" className="text-sm text-gray-500">جاري تحميل سجل المحاولات…</p>}
    {rows.map(row => <div key={row.id} className="border-t py-2 text-sm">
      <p>{fmtSyria(row.startedAt)} — {row.status === 'INTERRUPTED' ? row.warning : row.stageLabel}</p>
      <p className="text-xs text-gray-500">{row.actorType === 'SERVICE' ? 'خدمة آلية' : row.actorType === 'HUMAN' ? row.actorName || 'مستخدم' : 'غير محدد'} ({row.authMethod})</p>
      {row.failedStageLabel && <p className="text-xs text-red-700">مرحلة الفشل: {row.failedStageLabel}</p>}
      {typeof row.elapsedMs === 'number' && <p className="text-xs">الزمن المسجل: {(row.elapsedMs / 1000).toFixed(1)} ثانية</p>}
      {row.completedAt && <p className="text-xs">نهاية المعالجة: {fmtSyria(row.completedAt)}</p>}
      <code className="text-xs">{row.id}</code>
      {row.batchId && <a className="text-blue-600 mx-2" href={`/upload-history?batch=${row.batchId}`}>الدفعة</a>}
    </div>)}
    {!loading && !error && !rows.length && <p className="text-sm text-gray-500">لا توجد محاولات مسجلة بعد تفعيل التتبع.</p>}
  </section>
}
