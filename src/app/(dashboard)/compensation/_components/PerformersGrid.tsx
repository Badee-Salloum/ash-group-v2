'use client'
import { useMemo } from 'react'
import Link from 'next/link'
import { Trophy, AlertTriangle, Sparkles } from 'lucide-react'

export interface PerformerRow {
  id: string
  name: string
  employeeCode: string | null
  jobTitle: string | null
  operationsHandled: number
  matchRate: number
  errorCount: number
  theftCount: number
  complaintCount: number
  cumulativeStreak: number
}

interface Props {
  rows: PerformerRow[]
}

const MIN_OPS_FOR_TOP = 20 // sample size guard so a 100% match rate on 2 ops doesn't crown anyone

export function PerformersGrid({ rows }: Props) {
  // Memoize the two rankings — both are O(N log N) and used to re-run on
  // every parent re-render (search keystroke, filter toggle, etc.).
  const top = useMemo(() =>
    [...rows]
      .filter(r => r.operationsHandled >= MIN_OPS_FOR_TOP)
      .sort((a, b) => {
        if (b.matchRate !== a.matchRate) return b.matchRate - a.matchRate
        return b.operationsHandled - a.operationsHandled
      })
      .slice(0, 3),
  [rows])

  const needsAttention = useMemo(() =>
    [...rows]
      .filter(r => (r.errorCount + r.theftCount + r.complaintCount) > 0)
      .sort((a, b) => {
        const aScore = a.errorCount * 2 + a.theftCount * 5 + a.complaintCount
        const bScore = b.errorCount * 2 + b.theftCount * 5 + b.complaintCount
        return bScore - aScore
      })
      .slice(0, 3),
  [rows])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <PerformerCard
        title="أبطال الفترة"
        icon={<Trophy size={16} className="text-emerald-600" />}
        accent="emerald"
        empty="لا توجد بيانات كافية بعد لاختيار أبطال (يتطلب ≥ 20 عملية)."
      >
        {top.length === 0 ? null : top.map((r, i) => (
          <PerformerRow key={r.id} row={r} rank={i + 1} kind="top" />
        ))}
      </PerformerCard>

      <PerformerCard
        title="بحاجة لمتابعة"
        icon={<AlertTriangle size={16} className="text-amber-600" />}
        accent="amber"
        empty="لا توجد حالات تحتاج تدخّلاً في هذه الفترة. 🎉"
      >
        {needsAttention.length === 0 ? null : needsAttention.map((r, i) => (
          <PerformerRow key={r.id} row={r} rank={i + 1} kind="watch" />
        ))}
      </PerformerCard>
    </div>
  )
}

function PerformerCard({ title, icon, accent, empty, children }: {
  title: string
  icon: React.ReactNode
  accent: 'emerald' | 'amber'
  empty: string
  children: React.ReactNode
}) {
  const headerCls = accent === 'emerald'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-amber-50 text-amber-700 border-amber-200'
  const hasContent = !!children && (Array.isArray(children) ? children.some(Boolean) : true)
  return (
    <div className="card overflow-hidden">
      <div className={`px-4 py-2.5 border-b flex items-center gap-2 font-bold text-sm ${headerCls}`}>
        {icon}
        {title}
      </div>
      {hasContent ? (
        <ul className="divide-y divide-slate-100">{children}</ul>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-gray-400">{empty}</div>
      )}
    </div>
  )
}

function PerformerRow({ row, rank, kind }: { row: PerformerRow; rank: number; kind: 'top' | 'watch' }) {
  return (
    <li className="px-4 py-3 hover:bg-slate-50/60">
      <Link href={`/compensation/${row.id}`} className="flex items-center gap-3">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
          rank === 1 ? 'bg-amber-200 text-amber-800'
            : rank === 2 ? 'bg-slate-200 text-slate-700'
            : 'bg-orange-200 text-orange-800'
        }`}>#{rank}</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{row.name}</div>
          <div className="text-[11px] text-gray-500 truncate">{row.jobTitle || '—'}</div>
        </div>
        {kind === 'top' ? (
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <Chip color="emerald" label={`${row.matchRate}% مطابقة`} />
            <Chip color="blue" label={`${row.operationsHandled} عملية`} />
            {row.cumulativeStreak > 0 && (
              <Chip color="amber" label={`${row.cumulativeStreak}w streak`} icon={<Sparkles size={9} />} />
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {row.errorCount > 0 && <Chip color="amber" label={`${row.errorCount} خطأ`} />}
            {row.theftCount > 0 && <Chip color="rose" label={`${row.theftCount} سرقة`} />}
            {row.complaintCount > 0 && <Chip color="violet" label={`${row.complaintCount} شكوى`} />}
          </div>
        )}
      </Link>
    </li>
  )
}

function Chip({ color, label, icon }: { color: 'emerald' | 'blue' | 'amber' | 'rose' | 'violet'; label: string; icon?: React.ReactNode }) {
  const cls = {
    emerald: 'bg-emerald-100 text-emerald-700',
    blue:    'bg-blue-100 text-blue-700',
    amber:   'bg-amber-100 text-amber-700',
    rose:    'bg-rose-100 text-rose-700',
    violet:  'bg-violet-100 text-violet-700',
  }[color]
  return <span className={`text-[10px] font-semibold inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded ${cls}`}>{icon}{label}</span>
}
