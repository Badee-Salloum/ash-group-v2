'use client'
import { AlertTriangle, Inbox, TrendingDown, X } from 'lucide-react'
import type { ScorecardRow } from './ScorecardTable'

export interface CompensationFilters {
  role: string                  // '' = all, otherwise UserRole value
  withErrors: boolean
  withComplaints: boolean
  lowMatchRate: boolean         // matchRate < 70
}

export const EMPTY_FILTERS: CompensationFilters = {
  role: '',
  withErrors: false,
  withComplaints: false,
  lowMatchRate: false,
}

const ROLE_OPTIONS = [
  { value: '',              label: 'كل الأدوار' },
  { value: 'EMPLOYEE',      label: 'موظف' },
  { value: 'SHIFT_MANAGER', label: 'مدير نوبة' },
  { value: 'MANAGER',       label: 'مدير فرع' },
  { value: 'SUPERVISOR',    label: 'مشرف' },
  { value: 'ACCOUNT_MGR',   label: 'مدير حساب' },
  { value: 'ACCOUNTANT',    label: 'محاسب' },
  { value: 'ADMIN',         label: 'مدير عام' },
]

interface Props {
  filters: CompensationFilters
  setFilters: (f: CompensationFilters) => void
  totalRows: number
  visibleRows: number
}

export function AdvancedFilters({ filters, setFilters, totalRows, visibleRows }: Props) {
  const hasActive = filters.role !== '' || filters.withErrors || filters.withComplaints || filters.lowMatchRate
  return (
    <div className="card p-3 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="input text-sm py-1 w-auto"
          value={filters.role}
          onChange={e => setFilters({ ...filters, role: e.target.value })}
        >
          {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <Chip
          active={filters.withErrors}
          onClick={() => setFilters({ ...filters, withErrors: !filters.withErrors })}
          icon={<AlertTriangle size={12} />}
          tone="amber"
        >
          يحوي أخطاء
        </Chip>
        <Chip
          active={filters.withComplaints}
          onClick={() => setFilters({ ...filters, withComplaints: !filters.withComplaints })}
          icon={<Inbox size={12} />}
          tone="violet"
        >
          يحوي شكاوى
        </Chip>
        <Chip
          active={filters.lowMatchRate}
          onClick={() => setFilters({ ...filters, lowMatchRate: !filters.lowMatchRate })}
          icon={<TrendingDown size={12} />}
          tone="rose"
        >
          مطابقة أقل من 70%
        </Chip>

        {hasActive && (
          <button
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="text-xs px-2.5 py-1 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors inline-flex items-center gap-1"
          >
            <X size={12} /> مسح الفلاتر
          </button>
        )}
      </div>
      <div className="text-[11px] text-gray-500 flex items-center gap-2">
        <span>
          يُعرَض <span className="font-mono font-semibold text-gray-800">{visibleRows.toLocaleString('ar')}</span>
          {' '}من أصل <span className="font-mono">{totalRows.toLocaleString('ar')}</span> موظف
        </span>
        {hasActive && (
          <span className="badge bg-blue-100 text-blue-700 text-[10px]">فلتر نشط</span>
        )}
      </div>
    </div>
  )
}

function Chip({ active, onClick, icon, tone, children }: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  tone: 'amber' | 'violet' | 'rose'
  children: React.ReactNode
}) {
  const activeCls = {
    amber:  'bg-amber-100 text-amber-800 ring-amber-300',
    violet: 'bg-violet-100 text-violet-800 ring-violet-300',
    rose:   'bg-rose-100 text-rose-800 ring-rose-300',
  }[tone]
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-lg ring-1 transition-colors font-medium inline-flex items-center gap-1 ${
        active ? activeCls : 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-50'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

// Pure filter — kept here so /compensation/page.tsx and tests stay aligned.
export function applyFilters(rows: ScorecardRow[], filters: CompensationFilters): ScorecardRow[] {
  return rows.filter(r => {
    if (filters.role && r.role !== filters.role) return false
    if (filters.withErrors && (r.errorCount + r.theftCount) === 0) return false
    if (filters.withComplaints && r.complaintCount === 0) return false
    if (filters.lowMatchRate && (r.operationsHandled === 0 || r.matchRate >= 70)) return false
    return true
  })
}
