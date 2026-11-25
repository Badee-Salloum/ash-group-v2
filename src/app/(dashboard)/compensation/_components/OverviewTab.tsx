'use client'
// Overview tab of /compensation — the "نظرة عامة" view.
// Owns its own period selector + data fetch; mounted only when the active
// tab is "overview".

import { useEffect, useState, useCallback, useMemo } from 'react'
import { RefreshCw, Search, Calendar } from 'lucide-react'
import { fmtSyriaDate } from '@/lib/datetime'
import { GroupBonusModal, BonusEmployee } from '../../bonuses/_components/BonusModals'
import { HeroBand, HeroKpis } from './HeroBand'
import { PerformersGrid } from './PerformersGrid'
import { WeeklyTrendChart, TrendBucket } from './WeeklyTrendChart'
import { ScorecardTable, ScorecardRow, SortKey } from './ScorecardTable'
import { AdvancedFilters, CompensationFilters, EMPTY_FILTERS, applyFilters } from './AdvancedFilters'
import { PendingDuesCard, PendingDues } from './PendingDuesCard'
import { PeriodChooser, PeriodMode, effectiveRange, startOfWeek } from './PeriodChooser'

function toISODate(d: Date) { return d.toISOString().slice(0, 10) }

interface Props {
  onSwitchTab: (tab: 'payroll' | 'bonuses' | 'rules', filter?: string) => void
}

export function OverviewTab({ onSwitchTab }: Props) {
  const today = useMemo(() => new Date(), [])
  const [mode, setMode] = useState<PeriodMode>('week')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [rangeFrom, setRangeFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return toISODate(d)
  })
  const [rangeTo, setRangeTo] = useState(() => toISODate(today))
  const { from, to } = effectiveRange({ mode, weekStart, rangeFrom, rangeTo })
  const [current, setCurrent] = useState<HeroKpis | null>(null)
  const [previous, setPrevious] = useState<HeroKpis | null>(null)
  const [rows, setRows] = useState<ScorecardRow[]>([])
  const [trend, setTrend] = useState<TrendBucket[]>([])
  const [pendingDues, setPendingDues] = useState<PendingDues | null>(null)
  const [loadingRows, setLoadingRows] = useState(true)
  const [loadingTrend, setLoadingTrend] = useState(true)
  const [showGroup, setShowGroup] = useState(false)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('operations')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [filters, setFilters] = useState<CompensationFilters>(EMPTY_FILTERS)

  // Apply role / perf filters BEFORE the table and performers — both see
  // the narrowed view. HeroBand + chart stay server-side full-period.
  const filteredRows = useMemo(() => applyFilters(rows, filters), [rows, filters])

  const load = useCallback(async () => {
    setLoadingRows(true); setLoadingTrend(true)
    const qs = `from=${from}&to=${to}`
    try {
      const res = await fetch(`/api/compensation/dashboard?${qs}&compare=true`).then(r => r.json())
      if (res.success) {
        setCurrent(res.kpis)
        setPrevious(res.previous || null)
        if (Array.isArray(res.data)) setRows(res.data)
        if (Array.isArray(res.buckets)) setTrend(res.buckets)
        if (res.pendingDues) setPendingDues(res.pendingDues)
      }
    } finally {
      setLoadingRows(false)
      setLoadingTrend(false)
    }
  }, [from, to])

  useEffect(() => { load() }, [load])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir(k === 'name' ? 'asc' : 'desc') }
  }

  const employeesForModal: BonusEmployee[] = rows.map(r => ({
    id: r.id, name: r.name, employeeCode: r.employeeCode, baseSalary: r.baseSalary,
  }))

  // Per-row pay / undo-pay. On PAID we always POST /api/payroll first so
  // the underlying PayrollEntry gets refreshed with the latest live
  // cumulative bonus (otherwise a stale entry from before the streak grew
  // would pay out the old bonusAmount and skip the bonus expense). On
  // UNDO we just PATCH straight to DRAFT.
  // The PATCH endpoint owns the linked-expense lifecycle.
  async function onPayChange(row: ScorecardRow, status: 'PAID' | 'DRAFT') {
    let payrollId = row.latestPayrollId
    if (status === 'PAID') {
      const today = new Date()
      const ws = new Date(today)
      ws.setDate(today.getDate() - today.getDay())
      ws.setHours(0, 0, 0, 0)
      const weekStartStr = ws.toISOString().slice(0, 10)
      // POST is idempotent — it creates new entries or refreshes existing
      // ones with the live bonus + days-worked. Always run before PAID.
      const gen = await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart: weekStartStr }),
      })
      const gd = await gen.json()
      if (!gd.success) throw new Error(gd.error || 'تعذّر توليد سجل الراتب')
      // Re-fetch the id in case this was the first generation.
      if (!payrollId) {
        const list = await fetch(`/api/payroll?weekStart=${weekStartStr}`).then(x => x.json())
        type Row = { id: string; userId: string }
        const entry = (list.data as Row[] | undefined)?.find(e => e.userId === row.id)
        if (!entry) throw new Error('لم يُعثر على سجل الراتب المُولَّد')
        payrollId = entry.id
      }
    }
    const r = await fetch('/api/payroll', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: payrollId, status }),
    })
    const d = await r.json()
    if (!d.success) throw new Error(d.error || 'فشل تحديث الحالة')
    await load()
  }

  return (
    <div className="space-y-5">
      {/* Period selector + refresh */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <p className="text-sm text-gray-500 flex items-center gap-1.5">
          <Calendar size={13} />
          <span>{fmtSyriaDate(from)}</span>
          <span className="text-gray-400">←</span>
          <span>{fmtSyriaDate(to)}</span>
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodChooser
            mode={mode}
            setMode={setMode}
            weekStart={weekStart}
            setWeekStart={setWeekStart}
            rangeFrom={rangeFrom}
            setRangeFrom={setRangeFrom}
            rangeTo={rangeTo}
            setRangeTo={setRangeTo}
          />
          <button onClick={load} className="btn-secondary btn-sm">
            <RefreshCw size={14} /> تحديث
          </button>
        </div>
      </div>

      {/* Pending dues — top of the page */}
      {pendingDues && (
        <PendingDuesCard
          dues={pendingDues}
          onOpenPayroll={() => onSwitchTab('payroll', 'unpaid')}
        />
      )}

      <HeroBand current={current} previous={previous} periodFrom={from} periodTo={to} />

      <AdvancedFilters
        filters={filters}
        setFilters={setFilters}
        totalRows={rows.length}
        visibleRows={filteredRows.length}
      />

      <PerformersGrid rows={filteredRows} />

      <WeeklyTrendChart buckets={trend} loading={loadingTrend} />

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[160px]" />
        <div className="relative w-full sm:w-64">
          <Search size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            className="input py-1 text-xs pr-7 w-full"
            placeholder="بحث بالاسم / رقم الموظف / الوظيفة"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>
      <ScorecardTable
        rows={filteredRows}
        loading={loadingRows}
        search={search}
        setSearch={setSearch}
        sortKey={sortKey}
        sortDir={sortDir}
        setSort={toggleSort}
        onPayChange={onPayChange}
      />

      {showGroup && (
        <GroupBonusModal
          employees={employeesForModal}
          onClose={() => setShowGroup(false)}
          onSaved={() => { setShowGroup(false); load() }}
        />
      )}
    </div>
  )
}
