'use client'
import { SortableTable } from '@/components/tables/SortableTable'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowRight, User, Award, Wallet, AlertTriangle, Inbox, Loader2,
  Gift, Trash2, Edit2, Pencil,
} from 'lucide-react'
import { fmtSyria } from '@/lib/datetime'
import { BatchTraceBadge } from '@/components/ui/BatchTraceBadge'
import { ManualBonusModal, BonusEmployee } from '../../bonuses/_components/BonusModals'
import { AddDeductionModal } from '../../payroll/_components/AddDeductionModal'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import UserFormModal, { UserFormRecord } from '@/components/forms/UserFormModal'

interface EmployeeDetail {
  id: string
  name: string
  employeeCode: string | null
  jobTitle: string | null
  role: string
  avatarUrl: string | null
  baseSalary: number | null
  hireDate: string | null
  email: string
  phone: string | null
  address: string | null
  managerId: string | null
}

interface ManagerOption { id: string; name: string; jobTitle: string | null }
interface Kpis {
  operationsHandled: number
  matchedCount: number
  matchRate: number
  errorCount: number
  complaintCount: number
  cumulativeStreak: number
  cumulativeAmount: number
  lastErrorWeek: string | null
}
interface WeeklyTrendPoint { weekStart: string; matched: number; errors: number; net: number }
interface BonusHistoryRow {
  id: string; amount: number; type: string; reason: string | null; appliedAt: string | null
  weekStart: string | null; createdAt: string
  createdBy: { id: string; name: string } | null
}
interface PayrollHistoryRow {
  id: string; weekStart: string; weekEnd: string; baseSalary: number; workedHours: number
  expectedHours: number; bonusAmount: number; advanceAmount: number; deductions: number
  netAmount: number; status: string; paidAt: string | null; notes: string | null
}
interface ErrorRow {
  id: string; txDateTime: string; amount: number; currency: string; status: string
  type: string; source: string; reviewCategory: string | null; reviewNotes: string | null
  shamCashTxId: string | null; platformTxId: string | null
  account: { name: string; currency: string }
  batch: { id: string; batchDate: string | null; createdAt: string | null; uploaderName: string | null } | null
}
interface AssignedFollowUp {
  id: string; txDateTime: string; amount: number; currency: string
  reviewCategory: string | null; followUpStatus: string | null; reviewedAt: string | null
  accountName: string
}
interface DetailResponse {
  employee: EmployeeDetail
  kpis: Kpis
  weeklyTrend: WeeklyTrendPoint[]
  bonusHistory: BonusHistoryRow[]
  payrollHistory: PayrollHistoryRow[]
  recentErrors: ErrorRow[]
  assignedFollowUps: AssignedFollowUp[]
}

type Tab = 'bonuses' | 'payrolls' | 'errors' | 'followups'
const TAB_LABELS: Record<Tab, string> = {
  bonuses: 'سجل المكافآت', payrolls: 'سجل الرواتب',
  errors: 'الأخطاء الأخيرة', followups: 'المتابعات المُسنَدة',
}

export default function CompensationDetailPage() {
  const params = useParams<{ id: string }>()
  const userId = params?.id || ''
  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('errors')
  const [showManual, setShowManual] = useState(false)
  const [showAddDeduction, setShowAddDeduction] = useState(false)
  const [showEditEmployee, setShowEditEmployee] = useState(false)
  const [editingBonus, setEditingBonus] = useState<BonusHistoryRow | null>(null)
  const [managers, setManagers] = useState<ManagerOption[]>([])
  const confirm = useConfirm()
  const toast = useToast()

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const r = await fetch(`/api/compensation/employees/${userId}?weeks=12`)
      const d = await r.json()
      if (d.success) setData(d)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  // Managers dropdown for the "edit employee" modal — fetched once so the
  // modal can offer manager re-assignment without a second roundtrip.
  useEffect(() => {
    fetch('/api/employees')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          const list = (d.data || [])
            .filter((e: { id: string; isActive: boolean }) => e.isActive && e.id !== userId)
            .map((e: { id: string; name: string; jobTitle: string | null }) => ({
              id: e.id, name: e.name, jobTitle: e.jobTitle,
            }))
          setManagers(list)
        }
      })
      .catch(() => undefined)
  }, [userId])

  async function deleteBonus(id: string) {
    if (!(await confirm('حذف هذه المكافأة؟'))) return
    const r = await fetch(`/api/bonuses?id=${id}`, { method: 'DELETE' })
    const d = await r.json()
    if (d.success) { toast('تم حذف المكافأة', 'success'); load() }
    else toast(d.error || 'تعذّر الحذف', 'error')
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-gray-500">
        <Loader2 size={14} className="animate-spin" /> جاري التحميل...
      </div>
    )
  }

  const employeeForModal: BonusEmployee = {
    id: data.employee.id, name: data.employee.name, employeeCode: data.employee.employeeCode,
    baseSalary: data.employee.baseSalary,
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/compensation" className="btn-secondary btn-sm">
          <ArrowRight size={14} /> العودة
        </Link>
      </div>

      {/* Profile header */}
      <div className="card p-5">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white text-xl font-bold flex items-center justify-center shrink-0">
            {data.employee.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900">{data.employee.name}</h1>
            <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
              <User size={12} /> {data.employee.jobTitle || '—'} · {data.employee.role}
              {data.employee.employeeCode && <span className="badge bg-slate-100 text-slate-700">#{data.employee.employeeCode}</span>}
              {data.employee.hireDate && <span>· مُعيَّن في {fmtSyria(data.employee.hireDate, false)}</span>}
              {data.employee.baseSalary != null && (
                <span>· الراتب الأساس <span className="font-mono">{data.employee.baseSalary.toLocaleString('en')}</span> ل.س</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowManual(true)} className="btn-primary btn-sm">
              <Gift size={14} /> أضف مكافأة يدوية
            </button>
            <button onClick={() => setShowAddDeduction(true)} className="btn-secondary btn-sm">
              <Trash2 size={14} /> خصم سريع
            </button>
            <button onClick={() => setShowEditEmployee(true)} className="btn-secondary btn-sm">
              <Edit2 size={14} /> تعديل الموظف
            </button>
          </div>
        </div>
      </div>

      {/* KPI cards (period = last 30d) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={<Wallet size={14} />} label="عمليات الفترة" value={data.kpis.operationsHandled.toLocaleString('ar')} tone="emerald" />
        <Tile icon={<Award size={14} />} label="نسبة المطابقة" value={`${data.kpis.matchRate}%`} tone="blue" />
        <Tile icon={<AlertTriangle size={14} />} label="الأخطاء" value={data.kpis.errorCount.toLocaleString('ar')} tone="rose" />
        <Tile icon={<Inbox size={14} />} label="الشكاوى" value={data.kpis.complaintCount.toLocaleString('ar')} tone="amber" />
      </div>

      {/* Trend sparkline */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-800">الأداء الأسبوعي — آخر {data.weeklyTrend.length} أسابيع</h3>
          <div className="flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1"><span className="w-3 h-1 bg-emerald-500 rounded" /> مطابقة</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-1 bg-rose-500 rounded" /> أخطاء</span>
          </div>
        </div>
        <TrendChart trend={data.weeklyTrend} />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 flex-wrap border-b border-gray-100">
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm px-3 py-2 -mb-px border-b-2 transition-colors ${
              tab === t ? 'border-brand-600 text-brand-700 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {TAB_LABELS[t]} ({
              t === 'bonuses' ? data.bonusHistory.length :
              t === 'payrolls' ? data.payrollHistory.length :
              t === 'errors' ? data.recentErrors.length :
              data.assignedFollowUps.length
            })
          </button>
        ))}
      </div>

      {tab === 'bonuses' && (
        <BonusesTab
          rows={data.bonusHistory}
          onDelete={deleteBonus}
          onEdit={(b) => setEditingBonus(b)}
        />
      )}
      {tab === 'payrolls' && <PayrollsTab rows={data.payrollHistory} />}
      {tab === 'errors' && <ErrorsTab rows={data.recentErrors} />}
      {tab === 'followups' && <FollowupsTab rows={data.assignedFollowUps} userId={userId} />}

      {showManual && (
        <ManualBonusModal
          employees={[employeeForModal]}
          defaultUserId={userId}
          onClose={() => setShowManual(false)}
          onSaved={() => { setShowManual(false); load() }}
        />
      )}

      <UserFormModal
        open={showEditEmployee}
        mode="employee"
        editing={editingRecord(data.employee)}
        roleOptions={ROLE_OPTIONS}
        managers={managers}
        onClose={() => setShowEditEmployee(false)}
        onSaved={() => { setShowEditEmployee(false); load() }}
      />

      {/* Edit existing bonus — reuses the shared ManualBonusModal in
          edit-mode (PATCH /api/bonuses/[id]). */}
      {editingBonus && (
        <ManualBonusModal
          employees={[employeeForModal]}
          defaultUserId={userId}
          editingBonusId={editingBonus.id}
          initialAmount={editingBonus.amount}
          initialReason={editingBonus.reason}
          onClose={() => setEditingBonus(null)}
          onSaved={() => { setEditingBonus(null); load() }}
        />
      )}

      {/* Quick-deduction — pinned to this employee. */}
      {showAddDeduction && (
        <AddDeductionModal
          employees={[employeeForModal]}
          defaultUserId={userId}
          onClose={() => setShowAddDeduction(false)}
          onSaved={() => { setShowAddDeduction(false); load() }}
        />
      )}
    </div>
  )
}

const ROLE_OPTIONS = [
  { value: 'EMPLOYEE',      label: 'موظف' },
  { value: 'SHIFT_MANAGER', label: 'مدير نوبة' },
  { value: 'MANAGER',       label: 'مدير فرع' },
  { value: 'SUPERVISOR',    label: 'مشرف' },
  { value: 'ACCOUNT_MGR',   label: 'مدير حساب' },
  { value: 'ADMIN',         label: 'مدير عام' },
]

function editingRecord(e: EmployeeDetail): UserFormRecord {
  return {
    id: e.id,
    name: e.name,
    email: e.email,
    role: e.role,
    employeeCode: e.employeeCode,
    jobTitle: e.jobTitle,
    hireDate: e.hireDate,
    baseSalary: e.baseSalary,
    phone: e.phone,
    address: e.address,
    avatarUrl: e.avatarUrl,
    managerId: e.managerId,
  }
}

function Tile({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: string
  tone: 'emerald' | 'blue' | 'rose' | 'amber'
}) {
  const cls = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
  }[tone]
  return (
    <div className={`rounded-xl border px-4 py-3 ${cls}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-bold uppercase opacity-80">{label}</span>
        {icon}
      </div>
      <p className="text-xl font-extrabold font-mono">{value}</p>
    </div>
  )
}

function TrendChart({ trend }: { trend: WeeklyTrendPoint[] }) {
  if (trend.length === 0) return <div className="text-center text-xs text-gray-400 py-6">لا بيانات</div>
  const W = 600, H = 100, PAD = 8
  const maxY = Math.max(1, ...trend.map(p => Math.max(p.matched, p.errors)))
  const stepX = (W - PAD * 2) / Math.max(1, trend.length - 1)
  const yOf = (v: number) => H - PAD - (v / maxY) * (H - PAD * 2)
  const xOf = (i: number) => PAD + i * stepX
  const matchedPath = trend.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(p.matched).toFixed(1)}`).join(' ')
  const errorsPath = trend.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(p.errors).toFixed(1)}`).join(' ')
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#e5e7eb" strokeWidth="1" />
        <path d={matchedPath} fill="none" stroke="#10b981" strokeWidth="2" />
        <path d={errorsPath} fill="none" stroke="#f43f5e" strokeWidth="2" />
        {trend.map((p, i) => (
          <g key={p.weekStart}>
            <circle cx={xOf(i)} cy={yOf(p.matched)} r="2.5" fill="#10b981" />
            <circle cx={xOf(i)} cy={yOf(p.errors)} r="2.5" fill="#f43f5e" />
          </g>
        ))}
      </svg>
      <div className="flex justify-between text-[9px] text-gray-400 mt-1 px-2">
        {trend.map(p => <span key={p.weekStart}>{fmtSyria(p.weekStart, false).slice(5)}</span>)}
      </div>
    </div>
  )
}

const BONUS_TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  CUMULATIVE: { label: 'تراكمية', cls: 'bg-amber-100 text-amber-800' },
  GROUP:      { label: 'جماعية',  cls: 'bg-blue-100 text-blue-800' },
  MANUAL:     { label: 'فردية',   cls: 'bg-violet-100 text-violet-800' },
}

function BonusesTab({ rows, onDelete, onEdit }: {
  rows: BonusHistoryRow[]
  onDelete: (id: string) => void
  onEdit: (b: BonusHistoryRow) => void
}) {
  if (!rows.length) return <Empty>لا توجد مكافآت مسجَّلة لهذا الموظف.</Empty>
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <SortableTable className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-right px-3 py-2">التاريخ</th>
              <th className="text-right px-3 py-2">النوع</th>
              <th className="text-right px-3 py-2">المبلغ</th>
              <th className="text-right px-3 py-2">السبب</th>
              <th className="text-right px-3 py-2">بواسطة</th>
              <th className="text-right px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(b => {
              const t = BONUS_TYPE_LABELS[b.type] || { label: b.type, cls: 'bg-gray-100 text-gray-700' }
              return (
                <tr key={b.id}>
                  <td data-sort-value={b.appliedAt} className="px-3 py-2 text-xs font-mono">{b.appliedAt ? fmtSyria(b.appliedAt, false) : '—'}</td>
                  <td className="px-3 py-2"><span className={`badge ${t.cls}`}>{t.label}</span></td>
                  <td className="px-3 py-2 font-mono text-sm">{b.amount.toLocaleString('en')} ل.س</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{b.reason || '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{b.createdBy?.name || '—'}</td>
                  <td className="px-3 py-2">
                    {b.type !== 'CUMULATIVE' && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => onEdit(b)} className="text-blue-500 hover:text-blue-700 p-1 rounded" title="تعديل المكافأة">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => onDelete(b.id)} className="text-red-400 hover:text-red-600 p-1 rounded" title="حذف المكافأة">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </SortableTable>
      </div>
    </div>
  )
}

const PAYROLL_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  DRAFT:     { label: 'مسوّدة',  cls: 'bg-gray-100 text-gray-700' },
  CONFIRMED: { label: 'مؤكّدة',  cls: 'bg-sky-100 text-sky-700' },
  PAID:      { label: 'مدفوعة',  cls: 'bg-emerald-100 text-emerald-700' },
}

function PayrollsTab({ rows }: { rows: PayrollHistoryRow[] }) {
  if (!rows.length) return <Empty>لا توجد رواتب مسجَّلة.</Empty>
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <SortableTable className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-right px-3 py-2">الأسبوع</th>
              <th className="text-right px-3 py-2">أيام عمل</th>
              <th className="text-right px-3 py-2">الراتب</th>
              <th className="text-right px-3 py-2">المكافأة</th>
              <th className="text-right px-3 py-2">الخصومات</th>
              <th className="text-right px-3 py-2">الصافي</th>
              <th className="text-right px-3 py-2">الحالة</th>
              <th className="text-right px-3 py-2">دُفع</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(p => {
              const s = PAYROLL_STATUS_LABELS[p.status] || { label: p.status, cls: 'bg-gray-100' }
              return (
                <tr key={p.id}>
                  <td data-sort-value={p.weekStart} className="px-3 py-2 text-xs font-mono">{fmtSyria(p.weekStart, false)}</td>
                  <td className="px-3 py-2 font-mono">{p.workedHours}</td>
                  <td className="px-3 py-2 font-mono">{p.baseSalary.toLocaleString('en')}</td>
                  <td className="px-3 py-2 font-mono text-emerald-700">{p.bonusAmount.toLocaleString('en')}</td>
                  <td className="px-3 py-2 font-mono text-rose-700">{p.deductions.toLocaleString('en')}</td>
                  <td className="px-3 py-2 font-mono font-bold">{p.netAmount.toLocaleString('en')} ل.س</td>
                  <td className="px-3 py-2"><span className={`badge ${s.cls}`}>{s.label}</span></td>
                  <td data-sort-value={p.paidAt} className="px-3 py-2 text-xs text-gray-500">{p.paidAt ? fmtSyria(p.paidAt, false) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </SortableTable>
      </div>
    </div>
  )
}

const REVIEW_CAT_LABELS: Record<string, string> = {
  EMPLOYEE_ERROR: 'خطأ موظف', THEFT: 'سرقة', WASTE: 'هدر',
}

function ErrorsTab({ rows }: { rows: ErrorRow[] }) {
  if (!rows.length) return <Empty>لا توجد أخطاء/سرقات/هدر منسوبة لهذا الموظف. 👏</Empty>
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <SortableTable className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-right px-3 py-2">التاريخ</th>
              <th className="text-right px-3 py-2">الفئة</th>
              <th className="text-right px-3 py-2">المبلغ</th>
              <th className="text-right px-3 py-2">الحساب</th>
              <th className="text-right px-3 py-2">المصدر</th>
              <th className="text-right px-3 py-2">ملاحظة المراجعة</th>
              <th className="text-right px-3 py-2">الرفعة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(t => (
              <tr key={t.id}>
                <td data-sort-value={t.txDateTime} className="px-3 py-2 text-xs font-mono">{fmtSyria(t.txDateTime)}</td>
                <td className="px-3 py-2">
                  <span className={`badge ${
                    t.reviewCategory === 'THEFT' ? 'bg-red-100 text-red-800' :
                    t.reviewCategory === 'WASTE' ? 'bg-rose-100 text-rose-800' :
                    'bg-amber-100 text-amber-800'
                  }`}>
                    {t.reviewCategory ? REVIEW_CAT_LABELS[t.reviewCategory] || t.reviewCategory : '—'}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono">{t.amount.toLocaleString('en', { minimumFractionDigits: 2 })} {t.currency}</td>
                <td className="px-3 py-2 text-xs">{t.account.name}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{t.source === 'SHAM_CASH' ? 'شام كاش' : 'المنصة'}</td>
                <td className="px-3 py-2 text-xs text-gray-600 max-w-[200px] truncate">{t.reviewNotes || '—'}</td>
                <td className="px-3 py-2"><BatchTraceBadge batch={t.batch} /></td>
              </tr>
            ))}
          </tbody>
        </SortableTable>
      </div>
    </div>
  )
}

function FollowupsTab({ rows, userId }: { rows: AssignedFollowUp[]; userId: string }) {
  if (!rows.length) return <Empty>لا توجد متابعات نشطة مُسنَدة لهذا الموظف.</Empty>
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-bold text-sm">المتابعات النشطة ({rows.length})</h3>
        <Link
          href={`/follow-ups?assignedTo=${userId}`}
          className="text-xs text-brand-600 hover:underline"
        >
          فتح صفحة المتابعات لهذا الموظف ←
        </Link>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map(t => (
          <li key={t.id} className="px-4 py-2 text-sm flex items-center justify-between">
            <div>
              <span className="font-medium">{t.accountName}</span>
              <span className="text-xs text-gray-500 ms-2">{fmtSyria(t.txDateTime)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {t.followUpStatus === 'OPEN' && <span className="badge bg-amber-100 text-amber-800">مفتوحة</span>}
              {t.followUpStatus === 'IN_PROGRESS' && <span className="badge bg-sky-100 text-sky-800">قيد المعالجة</span>}
              <span className="font-mono">{t.amount.toLocaleString('en')} {t.currency}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card p-8 text-center text-sm text-gray-400">{children}</div>
}
