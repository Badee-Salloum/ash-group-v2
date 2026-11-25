'use client'
import Link from 'next/link'
import { FileUp } from 'lucide-react'
import { fmtSyria } from '@/lib/datetime'

// Trace info for the upload batch a transaction came in with. Shape mirrors
// what the transaction APIs now include alongside each row.
export interface BatchTraceInfo {
  id: string
  batchDate: string | null
  createdAt: string | null
  uploaderName: string | null
}

// Compact, clickable chip showing the upload date (DD-MM) of a transaction's
// source batch. Hover tooltip reveals the full timestamp + uploader. Click
// deep-links to /upload-history?batch=<id>, which auto-expands that batch's
// panel on arrival.
//
// Designed to be embedded inline next to the transaction date column on every
// page that lists transactions — keeps a consistent "where did this row come
// from?" affordance across /reconciliation, /customers, /follow-ups.
export function BatchTraceBadge({ batch }: { batch: BatchTraceInfo | null | undefined }) {
  if (!batch) {
    return <span className="text-[10px] text-gray-300" title="لا توجد دفعة مصدر مسجَّلة">—</span>
  }
  const stamp = batch.createdAt || batch.batchDate
  const short = stamp ? fmtSyria(stamp, false).slice(5) : '—'   // MM-DD slice
  const full = stamp ? fmtSyria(stamp) : ''
  const tooltip = [
    'مصدر الرفعة',
    full && `رُفعت في ${full}`,
    batch.uploaderName && `بواسطة ${batch.uploaderName}`,
    '— اضغط لفتح الدفعة في سجل الرفع',
  ].filter(Boolean).join('\n')

  return (
    <Link
      href={`/upload-history?batch=${batch.id}`}
      title={tooltip}
      className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-700 bg-violet-50 ring-1 ring-violet-200 rounded px-1.5 py-0.5 hover:bg-violet-100 transition-colors"
    >
      <FileUp size={9} />
      <span className="font-mono">{short}</span>
    </Link>
  )
}
