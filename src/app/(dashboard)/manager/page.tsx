'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Users, UserCheck, Clock, Sparkles, CalendarDays,
  ArrowLeft, Loader2, AlertCircle, TrendingUp, RefreshCw,
} from 'lucide-react'
import { fmtSyria } from '@/lib/datetime'
import { fmtSYP } from '@/lib/currency'

interface UserBrief {
  id: string
  name: string
  jobTitle: string | null
  avatarUrl?: string | null
}

interface DashboardData {
  weekStart: string
  weekEnd: string
  counts: {
    totalEmployees: number
    currentlyWorking: number
    pendingHandovers: number
    bonusesThisWeekCount: number
    bonusesThisWeekAmount: number
    attendanceTotalDays: number
    attendanceActiveEmployees: number
  }
  activeSessions: Array<{ id: string; startAt: string; shiftNumber: string | null; user: UserBrief }>
  pendingHandovers: Array<{ id: string; startAt: string; shiftNumber: string | null; user: UserBrief; handoverFromUserId: string | null }>
  upcomingShifts: Array<{ id: string; date: string; shiftNumber: string; isDayOff: boolean; user: UserBrief }>
}

const SHIFT_LABELS: Record<string, string> = {
  MORNING: 'صباحي',
  EVENING: 'مسائي',
  NIGHT: 'ليلي',
}

function Avatar({ user, size = 36 }: { user: UserBrief; size?: number }) {
  if (user.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.avatarUrl} alt={user.name} className="rounded-full object-cover ring-2 ring-white"
      style={{ width: size, height: size }} />
  }
  return (
    <div
      className="rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold ring-2 ring-white"
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.4) }}
    >
      {user.name.charAt(0)}
    </div>
  )
}

export default function ManagerDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/manager/dashboard')
      const d = await r.json()
      if (!d.success) throw new Error(d.error || 'فشل التحميل')
      setData(d.data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400 gap-2">
        <Loader2 className="animate-spin" size={20} /> جاري تحميل لوحة الفرع...
      </div>
    )
  }
  if (error) {
    return (
      <div className="card p-6 bg-red-50 text-red-700 flex items-center gap-2 max-w-2xl mx-auto">
        <AlertCircle size={18} /> {error}
      </div>
    )
  }
  if (!data) return null

  const c = data.counts
  const weekRangeLabel =
    `${new Date(data.weekStart).toLocaleDateString('ar-SY', { day: 'numeric', month: 'short' })} – ` +
    `${new Date(new Date(data.weekEnd).getTime() - 86_400_000).toLocaleDateString('ar-SY', { day: 'numeric', month: 'short' })}`

  const attendancePct = c.totalEmployees > 0
    ? Math.round((c.attendanceActiveEmployees / c.totalEmployees) * 100)
    : 0

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl p-6 text-white"
        style={{ background: 'linear-gradient(135deg, #0a2540 0%, #1e3a5f 50%, #2563eb 100%)' }}>
        <div className="absolute top-0 left-0 w-48 h-48 bg-cyan-400 rounded-full opacity-10 blur-3xl -translate-x-12 -translate-y-12" />
        <div className="absolute bottom-0 right-0 w-64 h-64 bg-blue-400 rounded-full opacity-10 blur-3xl translate-x-16 translate-y-16" />
        <div className="relative flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">لوحة مدير الفرع</h1>
            <p className="text-blue-100/80 text-sm mt-2 flex items-center gap-2">
              <CalendarDays size={14} /> أسبوع {weekRangeLabel}
            </p>
          </div>
          <button onClick={load} disabled={loading}
            className="bg-white/10 hover:bg-white/15 backdrop-blur border border-white/15 text-white text-sm rounded-lg px-3 py-1.5 flex items-center gap-2 transition">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </div>

      {/* Top row: 3 primary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          icon={<Users size={22} />}
          label="إجمالي الموظفين"
          value={c.totalEmployees}
          tone="blue"
          href="/employees"
        />
        <KpiCard
          icon={<UserCheck size={22} />}
          label="على رأس العمل الآن"
          value={c.currentlyWorking}
          tone="green"
          subtext={c.currentlyWorking === 0 ? 'لا أحد' : `${c.currentlyWorking} موظف نشط`}
          href="/shifts"
        />
        <KpiCard
          icon={<Clock size={22} />}
          label="مناوبات بانتظار الموافقة"
          value={c.pendingHandovers}
          tone="amber"
          highlight={c.pendingHandovers > 0}
          subtext={c.pendingHandovers > 0 ? 'تحتاج إلى مراجعة' : 'كل شيء على ما يرام'}
          href="/shifts"
        />
      </div>

      {/* Second row: weekly stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          icon={<Sparkles size={22} />}
          label="مكافآت هذا الأسبوع"
          value={c.bonusesThisWeekCount}
          tone="purple"
          subtext={c.bonusesThisWeekAmount > 0 ? `بقيمة ${fmtSYP(c.bonusesThisWeekAmount)}` : 'لا توجد مكافآت'}
          href="/bonuses"
        />
        <KpiCard
          icon={<CalendarDays size={22} />}
          label="إجمالي أيام الدوام"
          value={c.attendanceTotalDays}
          tone="indigo"
          subtext={`${c.attendanceActiveEmployees} موظف داوم هذا الأسبوع`}
          href="/attendance"
        />
        <ProgressCard
          icon={<TrendingUp size={22} />}
          label="نسبة الحضور هذا الأسبوع"
          value={attendancePct}
          subtext={`${c.attendanceActiveEmployees} من ${c.totalEmployees} موظف`}
        />
      </div>

      {/* Lists row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ListCard
          title="على رأس العمل الآن"
          icon={<UserCheck size={16} className="text-green-600" />}
          accent="green"
          empty="لا يوجد موظفون نشطون حالياً"
          items={data.activeSessions}
          href="/shifts"
          render={(s) => (
            <div key={s.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
              <Avatar user={s.user} size={34} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 text-sm truncate">{s.user.name}</p>
                <p className="text-xs text-gray-500 truncate">{s.user.jobTitle || '—'}</p>
              </div>
              {s.shiftNumber && (
                <span className="badge bg-green-50 text-green-700 text-[10px] whitespace-nowrap">
                  {SHIFT_LABELS[s.shiftNumber] || s.shiftNumber}
                </span>
              )}
            </div>
          )}
        />

        <ListCard
          title="مناوبات بانتظار الموافقة"
          icon={<Clock size={16} className="text-amber-600" />}
          accent="amber"
          empty="لا توجد مناوبات معلقة"
          items={data.pendingHandovers}
          href="/shifts"
          render={(s) => (
            <div key={s.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
              <Avatar user={s.user} size={34} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 text-sm truncate">{s.user.name}</p>
                <p className="text-xs text-gray-500 truncate">{fmtSyria(s.startAt, false)}</p>
              </div>
              <Link href="/shifts" className="text-amber-600 hover:text-amber-700 text-xs font-medium whitespace-nowrap">
                مراجعة ←
              </Link>
            </div>
          )}
        />

        <ListCard
          title="مناوبات اليوم وغداً"
          icon={<CalendarDays size={16} className="text-indigo-600" />}
          accent="indigo"
          empty="لا توجد مناوبات مجدولة"
          items={data.upcomingShifts}
          href="/schedule"
          render={(s) => {
            const isToday = new Date(s.date).toDateString() === new Date().toDateString()
            return (
              <div key={s.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                <Avatar user={s.user} size={32} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-800 text-sm truncate">{s.user.name}</p>
                  <p className="text-[10px] text-gray-400">{isToday ? 'اليوم' : 'غداً'}</p>
                </div>
                <span className={`badge text-[10px] whitespace-nowrap ${
                  s.isDayOff ? 'bg-gray-100 text-gray-500' : 'bg-indigo-50 text-indigo-700'
                }`}>
                  {s.isDayOff ? 'عطلة' : SHIFT_LABELS[s.shiftNumber] || s.shiftNumber}
                </span>
              </div>
            )
          }}
        />
      </div>
    </div>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────
const TONE_BG: Record<string, string> = {
  blue:   'from-blue-50 to-blue-100/40   text-blue-600',
  green:  'from-green-50 to-green-100/40 text-green-600',
  amber:  'from-amber-50 to-amber-100/40 text-amber-600',
  purple: 'from-purple-50 to-purple-100/40 text-purple-600',
  indigo: 'from-indigo-50 to-indigo-100/40 text-indigo-600',
}
const TONE_TEXT: Record<string, string> = {
  blue: 'text-blue-700', green: 'text-green-700', amber: 'text-amber-700',
  purple: 'text-purple-700', indigo: 'text-indigo-700',
}
const TONE_RING: Record<string, string> = {
  amber: 'ring-2 ring-amber-200',
}

function KpiCard({
  icon, label, value, subtext, tone, href, highlight,
}: {
  icon: React.ReactNode; label: string; value: number | string; subtext?: string;
  tone: keyof typeof TONE_BG; href?: string; highlight?: boolean
}) {
  const inner = (
    <div className={`group bg-white rounded-2xl border border-gray-100 p-5 h-full flex flex-col min-h-[160px] transition-all
      ${highlight ? TONE_RING[tone] || '' : ''}
      ${href ? 'hover:shadow-lg hover:-translate-y-0.5 cursor-pointer hover:border-gray-200' : ''}
    `}>
      {/* Header: icon + arrow */}
      <div className="flex items-start justify-between">
        <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${TONE_BG[tone]} flex items-center justify-center shrink-0`}>
          {icon}
        </div>
        {href && (
          <ArrowLeft size={14} className="text-gray-300 group-hover:text-gray-500 group-hover:-translate-x-0.5 transition mt-1" />
        )}
      </div>
      {/* Content pinned to bottom for uniform alignment across cards */}
      <div className="mt-auto pt-4">
        <p className="text-xs text-gray-500 font-medium leading-tight">{label}</p>
        <p className={`text-3xl font-bold font-mono mt-1 leading-none ${TONE_TEXT[tone]}`}>{value}</p>
        <p className="text-[11px] text-gray-400 mt-1.5 min-h-[14px]">{subtext || ' '}</p>
      </div>
    </div>
  )
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner
}

function ProgressCard({
  icon, label, value, subtext,
}: { icon: React.ReactNode; label: string; value: number; subtext?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 h-full flex flex-col min-h-[160px]">
      <div className="flex items-start">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-50 to-cyan-100/40 text-cyan-600 flex items-center justify-center shrink-0">
          {icon}
        </div>
      </div>
      <div className="mt-auto pt-4">
        <p className="text-xs text-gray-500 font-medium leading-tight">{label}</p>
        <p className="text-3xl font-bold font-mono mt-1 leading-none text-cyan-700">
          {value}<span className="text-lg text-cyan-400">%</span>
        </p>
        <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(100, value)}%`,
              background: 'linear-gradient(90deg, #06b6d4, #0ea5e9)',
            }}
          />
        </div>
        <p className="text-[11px] text-gray-400 mt-2 min-h-[14px]">{subtext || ' '}</p>
      </div>
    </div>
  )
}

function ListCard<T>({
  title, icon, empty, items, href, render, accent,
}: {
  title: string; icon: React.ReactNode; empty: string;
  items: T[]; href: string; render: (item: T) => React.ReactNode;
  accent: 'green' | 'amber' | 'indigo'
}) {
  const accentBar: Record<string, string> = {
    green:  'from-green-400 to-emerald-500',
    amber:  'from-amber-400 to-orange-500',
    indigo: 'from-indigo-400 to-blue-500',
  }
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden h-full flex flex-col min-h-[280px]">
      <div className={`h-1 bg-gradient-to-r ${accentBar[accent]}`} />
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-sm">
            {icon} {title}
            {items.length > 0 && (
              <span className="badge bg-gray-100 text-gray-600 text-[10px] mr-1">{items.length}</span>
            )}
          </h3>
          <Link href={href} className="text-[11px] text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap">
            عرض الكل ←
          </Link>
        </div>
        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-300 text-xs py-4">
            <div className="w-12 h-12 rounded-full bg-gray-50 mb-2 flex items-center justify-center">
              {icon}
            </div>
            {empty}
          </div>
        ) : (
          <div className="flex-1 max-h-72 overflow-y-auto -mx-1 px-1">
            {items.slice(0, 8).map(render)}
          </div>
        )}
      </div>
    </div>
  )
}
