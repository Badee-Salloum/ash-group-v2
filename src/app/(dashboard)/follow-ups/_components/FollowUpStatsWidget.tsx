'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageSquareWarning, Clock, AlertTriangle, ChevronLeft } from 'lucide-react'

interface StatsResponse {
  canViewAll: boolean
  global: { open: number; inProgress: number; stale: number } | null
  mine: { open: number; inProgress: number; stale: number }
  staleDays: number
}

interface Props {
  // 'global' shows org-wide counts (for privileged dashboards).
  // 'mine'   shows the current user's assigned counts only.
  mode: 'global' | 'mine'
  // Hide widget entirely if everything is zero (useful on employee dashboard).
  hideIfEmpty?: boolean
}

export function FollowUpStatsWidget({ mode, hideIfEmpty = false }: Props) {
  const [data, setData] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/follow-ups/stats')
      .then(r => r.json())
      .then(d => { if (d.success) setData(d.data) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="card h-24 skeleton" />
  }
  if (!data) return null

  const source = mode === 'global' ? data.global : data.mine
  if (!source) return null
  const total = source.open + source.inProgress

  if (hideIfEmpty && total === 0 && source.stale === 0) {
    return null
  }

  const title = mode === 'global' ? 'متابعات الزبائن والمنصات' : 'متابعاتي'
  const linkHref = mode === 'global' ? '/follow-ups' : '/follow-ups?assignedTo=me'

  return (
    <Link
      href={linkHref}
      className="card p-5 block hover:shadow-md transition-shadow group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
            <MessageSquareWarning size={18} />
          </div>
          <div>
            <h3 className="font-bold text-gray-800 text-sm">{title}</h3>
            <p className="text-[11px] text-gray-400">شكاوى وأخطاء بحاجة إجراء</p>
          </div>
        </div>
        <ChevronLeft size={16} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <div className="text-2xl font-bold font-mono text-amber-700">{source.open}</div>
          <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mt-0.5">مفتوحة</div>
        </div>
        <div className="text-center border-x border-gray-100">
          <div className="text-2xl font-bold font-mono text-sky-700">{source.inProgress}</div>
          <div className="text-[10px] font-bold text-sky-600 uppercase tracking-wider mt-0.5 flex items-center justify-center gap-1">
            <Clock size={9} /> قيد المعالجة
          </div>
        </div>
        <div className="text-center">
          <div className={`text-2xl font-bold font-mono ${source.stale > 0 ? 'text-rose-700' : 'text-gray-400'}`}>
            {source.stale}
          </div>
          <div className={`text-[10px] font-bold uppercase tracking-wider mt-0.5 flex items-center justify-center gap-1 ${
            source.stale > 0 ? 'text-rose-600' : 'text-gray-400'
          }`}>
            <AlertTriangle size={9} /> متأخّرة (&gt;{data.staleDays}ي)
          </div>
        </div>
      </div>
    </Link>
  )
}
