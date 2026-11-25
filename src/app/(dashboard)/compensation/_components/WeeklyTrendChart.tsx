'use client'
import { fmtSyria } from '@/lib/datetime'

export interface TrendBucket {
  weekStart: string
  matched: number
  errors: number
}

interface Props {
  buckets: TrendBucket[]
  loading: boolean
}

// Stacked-bar weekly trend chart. Pure SVG (no Recharts) — keeps bundle size
// down and matches the existing TrendChart on the per-employee detail page.
//
// Each week shows two bars side by side: matched (emerald) and errors (rose).
// Y-axis auto-scales to the period max.
export function WeeklyTrendChart({ buckets, loading }: Props) {
  if (loading) {
    return (
      <div className="card p-4">
        <div className="h-32 bg-gradient-to-l from-slate-50 to-slate-100/40 rounded animate-pulse" />
      </div>
    )
  }
  if (buckets.length === 0) {
    return (
      <div className="card p-4">
        <div className="h-32 flex items-center justify-center text-sm text-gray-400">
          لا توجد بيانات لرسم الاتجاه
        </div>
      </div>
    )
  }

  const W = 800, H = 140, PAD_X = 12, PAD_Y = 16
  const innerW = W - PAD_X * 2, innerH = H - PAD_Y * 2
  const maxY = Math.max(1, ...buckets.flatMap(b => [b.matched, b.errors]))
  const barGroupWidth = innerW / buckets.length
  const barWidth = Math.max(3, Math.min(18, barGroupWidth / 2.5))
  const yScale = (v: number) => (v / maxY) * innerH

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold text-sm text-gray-800">📊 الأداء الأسبوعي</h3>
          <span className="text-[10px] text-gray-400 bg-gray-50 ring-1 ring-gray-200 px-1.5 py-0.5 rounded font-medium">
            للفترة الكاملة · لا يتأثّر بالفلاتر
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-600">
          <span className="inline-flex items-center gap-1"><span className="w-3 h-2 bg-emerald-500 rounded-sm" /> مطابقات</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-2 bg-rose-500 rounded-sm" /> أخطاء</span>
          <span className="text-gray-400">· الذروة {maxY.toLocaleString('en')}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
          {/* Baseline */}
          <line x1={PAD_X} y1={H - PAD_Y} x2={W - PAD_X} y2={H - PAD_Y} stroke="#e5e7eb" strokeWidth="1" />
          {buckets.map((b, i) => {
            const groupX = PAD_X + i * barGroupWidth + barGroupWidth / 2
            const matchedH = yScale(b.matched)
            const errorsH = yScale(b.errors)
            return (
              <g key={b.weekStart}>
                <rect
                  x={groupX - barWidth - 1}
                  y={H - PAD_Y - matchedH}
                  width={barWidth}
                  height={matchedH}
                  fill="#10b981"
                  rx="2"
                >
                  <title>أسبوع {fmtSyria(b.weekStart, false)} · {b.matched} مطابقة</title>
                </rect>
                <rect
                  x={groupX + 1}
                  y={H - PAD_Y - errorsH}
                  width={barWidth}
                  height={errorsH}
                  fill="#f43f5e"
                  rx="2"
                >
                  <title>أسبوع {fmtSyria(b.weekStart, false)} · {b.errors} خطأ</title>
                </rect>
              </g>
            )
          })}
        </svg>
        <div className="flex justify-between text-[9px] text-gray-400 mt-1 px-2">
          {buckets.map(b => <span key={b.weekStart}>{fmtSyria(b.weekStart, false).slice(5)}</span>)}
        </div>
      </div>
    </div>
  )
}
