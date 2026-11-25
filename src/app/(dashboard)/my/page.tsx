'use client'
import { SortableTable } from '@/components/tables/SortableTable'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fmtSyria, fmtSyriaDate } from '@/lib/datetime'
import { fmtSYP } from '@/lib/currency'
import { LogIn, LogOut, Clock, AlertTriangle, TrendingUp, Sparkles, Award, Calendar, Activity, Bell, Gift, MinusCircle, Wallet, Banknote, CheckCheck, LayoutGrid } from 'lucide-react'
import { FollowUpStatsWidget } from '../follow-ups/_components/FollowUpStatsWidget'
import { PageHeader } from '@/components/ui/PageHeader'

interface NotificationRow {
  id: string
  type: string
  title: string
  body: string | null
  href: string | null
  readAt: string | null
  createdAt: string
}

const NOTIF_ICON: Record<string, React.ReactNode> = {
  BONUS_RECEIVED: <Gift size={14} className="text-emerald-600" />,
  DEDUCTION_APPLIED: <MinusCircle size={14} className="text-rose-600" />,
  PAYROLL_PAID: <Wallet size={14} className="text-blue-600" />,
  COMPLAINT_ATTRIBUTED: <AlertTriangle size={14} className="text-amber-600" />,
  ADVANCE_APPROVED: <Banknote size={14} className="text-emerald-600" />,
  ADVANCE_REJECTED: <Banknote size={14} className="text-rose-600" />,
}

function timeAgo(iso: string): string {
  const now = Date.now()
  const t = new Date(iso).getTime()
  const sec = Math.max(0, Math.floor((now - t) / 1000))
  if (sec < 60) return 'الآن'
  if (sec < 3600) return `منذ ${Math.floor(sec / 60)} دقيقة`
  if (sec < 86400) return `منذ ${Math.floor(sec / 3600)} ساعة`
  return `منذ ${Math.floor(sec / 86400)} يوم`
}

const ACTION_LABEL: Record<string, string> = {
  CHECK_IN: 'تسجيل دخول',
  REQUEST_END_SHIFT: 'طلب إنهاء الجلسة',
  APPROVE_HANDOVER: 'اعتماد تسليم',
  CANCEL_SHIFT: 'إلغاء جلسة',
  GENERATE_PAYROLL: 'توليد الرواتب',
  UPDATE_PAYROLL: 'تعديل راتب',
  LOGIN: 'تسجيل دخول النظام',
  LOGOUT: 'تسجيل خروج',
}

interface CoverageItem {
  id: string
  date: string
  startTime: string
  endTime: string
  coverForName: string | null
}

interface Data {
  user: { id: string; name: string; jobTitle: string | null; employeeCode: string | null; baseSalary: number | null; avatarUrl: string | null; hireDate: string | null }
  currentSession: { id: string; startAt: string; status: string } | null
  payrolls: Array<{
    id: string; weekStart: string; weekEnd: string;
    baseSalary: number; bonusAmount: number; netAmount: number; advanceAmount: number; workedHours: number;
    status: string; paidAt: string | null;
  }>
  stats: {
    operationsThisWeek: number
    operationsThisMonth: number
    errorsTotal: number
    cumulativeBonus: number
    cumulativeWeekStart: string | null
  }
  recentActivity: Array<{ id: string; action: string; entity: string | null; createdAt: string }>
  coverages: CoverageItem[]
}

export default function MyDashboardPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  // Phase E — personal notifications panel. Loaded alongside the dashboard.
  // Visiting /my also clears the unread badge in the topbar (markAllAsRead).
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    fetch('/api/my/dashboard').then(r => r.json()).then(d => {
      if (d.success) setData(d)
    }).finally(() => setLoading(false))
    refreshNotifications()
  }, [])

  function refreshNotifications() {
    fetch('/api/notifications').then(r => r.json()).then(d => {
      if (d.success) {
        setNotifications(d.data)
        setUnreadCount(d.unreadCount)
      }
    }).catch(() => {})
  }

  async function markAllRead() {
    await fetch('/api/notifications/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAllAsRead: true }),
    })
    setUnreadCount(0)
    setNotifications(prev => prev.map(n => n.readAt ? n : { ...n, readAt: new Date().toISOString() }))
  }

  if (loading) return (
    <div className="space-y-5">
      <div className="card p-5 flex items-center gap-4">
        <div className="skeleton w-14 h-14 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-5 w-44 rounded-lg" />
          <div className="skeleton h-3 w-28 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4 space-y-2">
            <div className="skeleton h-3 w-20 rounded-lg" />
            <div className="skeleton h-7 w-16 rounded-lg" />
          </div>
        ))}
      </div>
      <div className="card p-5 space-y-3">
        <div className="skeleton h-4 w-40 rounded-lg" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-12 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )

  if (!data || !data.user) return (
    <div className="card p-12 text-center text-gray-400">لا توجد بيانات</div>
  )

  const u = data.user
  const s = data.stats
  const lastPayroll = data.payrolls[0]

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<LayoutGrid size={20} />}
        title="لوحة الموظف الشخصية"
        subtitle="نظرة عامة على أدائك ورواتبك وإشعاراتك"
      />

      {/* Profile card */}
      <div className="card p-5">
        <div className="flex items-center gap-4">
          {u.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={u.avatarUrl} alt={u.name} className="w-14 h-14 rounded-full object-cover" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white text-xl font-bold flex items-center justify-center">
              {u.name.charAt(0)}
            </div>
          )}
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">{u.name}</h1>
            <p className="text-sm text-gray-500">
              {u.jobTitle || '—'}
              {u.employeeCode && <span className="font-mono text-gray-400 mx-2">·</span>}
              {u.employeeCode && <span className="font-mono text-xs">{u.employeeCode}</span>}
            </p>
            <div className="flex flex-wrap gap-3 mt-1.5 text-[11px] text-gray-500">
              {u.hireDate && (
                <span className="flex items-center gap-1">
                  <Calendar size={11} /> تاريخ التعيين: <span className="font-mono">{fmtSyriaDate(u.hireDate)}</span>
                </span>
              )}
              {u.baseSalary !== null && (
                <span className="flex items-center gap-1">
                  راتب أساسي: <span className="font-mono font-bold text-gray-700">{fmtSYP(u.baseSalary)}</span>
                </span>
              )}
            </div>
          </div>
          <Link href="/shifts" className="btn-primary">
            {data.currentSession
              ? <><LogOut size={14} /> الجلسة الحالية</>
              : <><LogIn size={14} /> تسجيل دخول</>
            }
          </Link>
        </div>
      </div>

      {/* Active session banner */}
      {data.currentSession && (
        <div className="card p-4 border-r-4 border-emerald-500 bg-emerald-50/30">
          <div className="flex items-center gap-3">
            <Clock size={20} className="text-emerald-600" />
            <div>
              <p className="font-bold text-emerald-700">
                جلسة {data.currentSession.status === 'ACTIVE' ? 'نشطة' : 'بانتظار التسليم'}
              </p>
              <p className="text-xs text-gray-500 font-mono">بدأت {fmtSyria(data.currentSession.startAt)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Personal follow-up assignments — hidden when nothing is assigned */}
      <FollowUpStatsWidget mode="mine" hideIfEmpty />

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] sm:text-xs text-gray-400 font-bold uppercase">عمليات الأسبوع</p>
            <TrendingUp size={14} className="text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-gray-800 font-mono">{s.operationsThisWeek}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] sm:text-xs text-gray-400 font-bold uppercase">عمليات الشهر</p>
            <TrendingUp size={14} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-gray-800 font-mono">{s.operationsThisMonth}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] sm:text-xs text-rose-500 font-bold uppercase">أخطاء منسوبة</p>
            <AlertTriangle size={14} className="text-rose-500" />
          </div>
          <p className="text-2xl font-bold text-rose-700 font-mono">{s.errorsTotal}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] sm:text-xs text-amber-500 font-bold uppercase">المكافأة التراكمية</p>
            <Sparkles size={14} className="text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-amber-700 font-mono">{fmtSYP(s.cumulativeBonus)}</p>
          {/* progress bar — target 50,000 ل.س then resets */}
          <div className="mt-2 h-1.5 bg-amber-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-l from-amber-500 to-amber-300 transition-all"
              style={{ width: `${Math.min(100, (s.cumulativeBonus / 50000) * 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-400 mt-1">
            {s.errorsTotal > 0 ? '⚠ سيُعاد التصفير عند خطأ' : `+5,000 ل.س الأسبوع القادم`}
          </p>
        </div>
      </div>

      {/* Phase F — coverage hours for this week (extends expected hours) */}
      {data.coverages && data.coverages.length > 0 && (
        <div className="card p-4">
          <h2 className="font-bold text-gray-800 mb-3 inline-flex items-center gap-2">
            <Clock size={16} className="text-amber-600" />
            ساعاتك المتوقّعة لهذا الأسبوع — تغطيات إضافية
          </h2>
          <ul className="divide-y divide-gray-100">
            {data.coverages.map(c => (
              <li key={c.id} className="py-2 flex items-center justify-between text-sm">
                <span className="font-medium text-gray-800">
                  {fmtSyriaDate(c.date)}
                </span>
                <span className="font-mono text-gray-600" dir="ltr">{c.startTime} → {c.endTime}</span>
                <span className="text-xs text-gray-500">
                  +4 ساعات{c.coverForName ? ` لتغطية ${c.coverForName}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Phase E — personal notifications inbox */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <Bell size={16} className="text-blue-600" />
            الإشعارات
            {unreadCount > 0 && (
              <span className="badge bg-blue-100 text-blue-700 text-[10px]">{unreadCount} غير مقروء</span>
            )}
          </h2>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-1">
              <CheckCheck size={13} /> تحديد الكل كمقروء
            </button>
          )}
        </div>
        {notifications.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-6">لا توجد إشعارات بعد.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {notifications.slice(0, 8).map(n => {
              const unread = !n.readAt
              const icon = NOTIF_ICON[n.type] ?? <Bell size={14} className="text-gray-400" />
              const Wrapper: React.ElementType = n.href ? Link : 'div'
              const wrapperProps = n.href ? { href: n.href } : {}
              return (
                <li key={n.id} className={`py-2.5 ${unread ? 'border-r-2 border-blue-500 pr-2 -mr-2' : ''}`}>
                  <Wrapper {...wrapperProps} className="flex items-start gap-2.5 hover:bg-gray-50 -mx-1 px-1 rounded transition-colors">
                    <span className="mt-0.5 shrink-0">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${unread ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>{n.title}</p>
                      {n.body && <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-[10px] text-gray-400 mt-0.5">{timeAgo(n.createdAt)}</p>
                    </div>
                  </Wrapper>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Last payroll highlight */}
      {lastPayroll && (
        <div className="card p-5 bg-gradient-to-l from-blue-50 to-white">
          <div className="flex items-center gap-2 mb-3">
            <Award size={16} className="text-blue-600" />
            <h2 className="font-bold text-gray-800">راتب الأسبوع الأخير</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <div>
              <p className="text-[11px] sm:text-xs text-gray-400 font-bold uppercase">الفترة</p>
              <p className="font-mono text-xs">{fmtSyriaDate(lastPayroll.weekStart)}</p>
            </div>
            <div>
              <p className="text-[11px] sm:text-xs text-gray-400 font-bold uppercase">أساسي</p>
              <p className="font-mono">{fmtSYP(lastPayroll.baseSalary)}</p>
            </div>
            <div>
              <p className="text-[11px] sm:text-xs text-emerald-500 font-bold uppercase">مكافأة</p>
              <p className="font-mono text-emerald-700">+{fmtSYP(lastPayroll.bonusAmount)}</p>
            </div>
            <div>
              <p className="text-[11px] sm:text-xs text-amber-500 font-bold uppercase">سلفة</p>
              <p className="font-mono text-amber-700">−{fmtSYP(lastPayroll.advanceAmount)}</p>
            </div>
            <div>
              <p className="text-[11px] sm:text-xs text-blue-500 font-bold uppercase">الصافي</p>
              <p className="font-mono font-bold text-blue-700 text-lg">{fmtSYP(lastPayroll.netAmount)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Recent activity */}
      {data.recentActivity.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity size={16} className="text-blue-600" />
            <h2 className="font-bold text-gray-800">آخر النشاطات</h2>
          </div>
          <ul className="space-y-2">
            {data.recentActivity.slice(0, 6).map(a => (
              <li key={a.id} className="flex items-center justify-between text-sm border-b border-gray-50 last:border-0 pb-1.5">
                <span className="text-gray-700">{ACTION_LABEL[a.action] || a.action}</span>
                <span className="text-[11px] text-gray-400 font-mono">{fmtSyria(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Past payrolls */}
      {data.payrolls.length > 1 && (
        <div className="card p-4">
          <h2 className="font-bold text-gray-800 mb-3">الرواتب السابقة</h2>
          <div className="overflow-x-auto">
            <SortableTable className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">الأسبوع</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-600">ساعات</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-600">المكافأة</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-600">الصافي</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-600">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {data.payrolls.slice(1).map(p => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td data-sort-value={p.weekStart} className="px-3 py-2 font-mono text-xs">{fmtSyriaDate(p.weekStart)}</td>
                    <td className="px-3 py-2 text-center font-mono text-xs">{p.workedHours.toFixed(1)}</td>
                    <td data-sort-value={p.bonusAmount} className="px-3 py-2 text-center font-mono text-emerald-700">+{fmtSYP(p.bonusAmount)}</td>
                    <td data-sort-value={p.netAmount} className="px-3 py-2 text-center font-mono font-bold">{fmtSYP(p.netAmount)}</td>
                    <td className="px-3 py-2 text-center">
                      {p.status === 'PAID' ? (
                        <span className="badge bg-emerald-100 text-emerald-700">مدفوع</span>
                      ) : p.status === 'CONFIRMED' ? (
                        <span className="badge bg-blue-100 text-blue-700">معتمد</span>
                      ) : (
                        <span className="badge bg-gray-100 text-gray-700">مسودة</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </SortableTable>
          </div>
        </div>
      )}
    </div>
  )
}
