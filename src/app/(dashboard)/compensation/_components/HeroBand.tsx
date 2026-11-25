'use client'
import { Wallet, Gift, AlertTriangle, TrendingUp, ArrowUp, ArrowDown, Minus } from 'lucide-react'

export interface HeroKpis {
  salaryPaid: number
  bonusTotal: number
  errorCount: number
  matchRate: number
}

interface Props {
  current: HeroKpis | null
  previous: HeroKpis | null
  periodFrom: string
  periodTo: string
}

// Top hero band — 4 big tiles with delta-vs-previous-period indicators.
// Designed to dominate the page so the manager gets the punchline in 2s.
export function HeroBand({ current, previous, periodFrom, periodTo }: Props) {
  const cards = [
    {
      key: 'salary',
      icon: <Wallet size={18} />,
      label: 'الرواتب المدفوعة',
      value: current ? formatBig(current.salaryPaid) : '—',
      unit: 'ل.س',
      delta: delta(current?.salaryPaid, previous?.salaryPaid),
      tone: 'emerald' as const,
    },
    {
      key: 'bonus',
      icon: <Gift size={18} />,
      label: 'المكافآت',
      value: current ? formatBig(current.bonusTotal) : '—',
      unit: 'ل.س',
      delta: delta(current?.bonusTotal, previous?.bonusTotal),
      tone: 'violet' as const,
    },
    {
      key: 'errors',
      icon: <AlertTriangle size={18} />,
      label: 'الأخطاء',
      value: current ? current.errorCount.toLocaleString('en') : '—',
      delta: delta(current?.errorCount, previous?.errorCount, true),
      tone: 'rose' as const,
    },
    {
      key: 'match',
      icon: <TrendingUp size={18} />,
      label: 'نسبة المطابقة',
      value: current ? `${current.matchRate}%` : '—',
      delta: delta(current?.matchRate, previous?.matchRate),
      tone: 'blue' as const,
    },
  ]
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-end">
        <span className="text-[10px] text-gray-400 bg-gray-50 ring-1 ring-gray-200 px-1.5 py-0.5 rounded font-medium">
          مؤشّرات الفترة الكاملة · لا تتأثّر بالفلاتر
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map(({ key, ...rest }) => (
          <HeroCard key={key} {...rest} />
        ))}
      </div>
    </div>
  )
}

function HeroCard({ icon, label, value, unit, delta, tone }: {
  icon: React.ReactNode
  label: string
  value: string
  unit?: string
  delta: Delta
  tone: 'emerald' | 'violet' | 'rose' | 'blue'
}) {
  const cls = {
    emerald: 'from-emerald-50 to-emerald-100/40 border-emerald-200 text-emerald-700',
    violet:  'from-violet-50 to-violet-100/40 border-violet-200 text-violet-700',
    rose:    'from-rose-50 to-rose-100/40 border-rose-200 text-rose-700',
    blue:    'from-blue-50 to-blue-100/40 border-blue-200 text-blue-700',
  }[tone]
  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-4 ${cls}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wider opacity-90">{label}</span>
        <span className="opacity-70">{icon}</span>
      </div>
      <p className="text-2xl sm:text-3xl font-extrabold font-mono leading-none">
        {value}
        {unit && <span className="text-sm font-semibold opacity-80 ms-1">{unit}</span>}
      </p>
      <DeltaPill delta={delta} />
    </div>
  )
}

interface Delta { direction: 'up' | 'down' | 'flat' | 'na'; pct: number | null; positive: boolean }

function delta(current: number | undefined, previous: number | undefined, lowerIsBetter = false): Delta {
  if (current == null || previous == null) return { direction: 'na', pct: null, positive: true }
  if (previous === 0) {
    if (current === 0) return { direction: 'flat', pct: 0, positive: true }
    return { direction: 'up', pct: null, positive: !lowerIsBetter }
  }
  const change = ((current - previous) / Math.abs(previous)) * 100
  if (Math.abs(change) < 0.5) return { direction: 'flat', pct: 0, positive: true }
  const direction: Delta['direction'] = change > 0 ? 'up' : 'down'
  const positive = lowerIsBetter ? change < 0 : change > 0
  return { direction, pct: Math.round(Math.abs(change) * 10) / 10, positive }
}

function DeltaPill({ delta }: { delta: Delta }) {
  if (delta.direction === 'na') return <p className="text-[10px] mt-1 opacity-50">—</p>
  const Icon = delta.direction === 'up' ? ArrowUp : delta.direction === 'down' ? ArrowDown : Minus
  const tone = delta.positive ? 'text-emerald-700 bg-emerald-100' : 'text-rose-700 bg-rose-100'
  return (
    <p className={`text-[11px] font-semibold mt-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${tone}`}>
      <Icon size={11} />
      {delta.pct != null ? `${delta.pct}%` : 'جديد'} vs الفترة السابقة
    </p>
  )
}

function formatBig(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString('en')
}
