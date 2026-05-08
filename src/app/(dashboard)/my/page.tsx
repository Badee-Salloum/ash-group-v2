'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fmtSyria, fmtSyriaDate } from '@/lib/datetime'
import { fmtSYP } from '@/lib/currency'
import { Loader2, LogIn, LogOut, Clock, AlertTriangle, TrendingUp, Sparkles, Award, Calendar, Activity } from 'lucide-react'
import { FollowUpStatsWidget } from '../follow-ups/_components/FollowUpStatsWidget'

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
}

export default function MyDashboardPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/my/dashboard').then(r => r.json()).then(d => {
      if (d.success) setData(d)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center p-20 text-gray-400 gap-2">
      <Loader2 size={20} className="animate-spin" /> جاري التحميل...
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
      {/* Header */}
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
            <p className="text-[10px] text-gray-400 font-bold uppercase">عمليات الأسبوع</p>
            <TrendingUp size={14} className="text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-gray-800 font-mono">{s.operationsThisWeek}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-gray-400 font-bold uppercase">عمليات الشهر</p>
            <TrendingUp size={14} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-gray-800 font-mono">{s.operationsThisMonth}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-rose-500 font-bold uppercase">أخطاء منسوبة</p>
            <AlertTriangle size={14} className="text-rose-500" />
          </div>
          <p className="text-2xl font-bold text-rose-700 font-mono">{s.errorsTotal}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-amber-500 font-bold uppercase">المكافأة التراكمية</p>
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

      {/* Last payroll highlight */}
      {lastPayroll && (
        <div className="card p-5 bg-gradient-to-l from-blue-50 to-white">
          <div className="flex items-center gap-2 mb-3">
            <Award size={16} className="text-blue-600" />
            <h2 className="font-bold text-gray-800">راتب الأسبوع الأخير</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <div>
              <p className="text-[10px] text-gray-400 font-bold uppercase">الفترة</p>
              <p className="font-mono text-xs">{fmtSyriaDate(lastPayroll.weekStart)}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-bold uppercase">أساسي</p>
              <p className="font-mono">{fmtSYP(lastPayroll.baseSalary)}</p>
            </div>
            <div>
              <p className="text-[10px] text-emerald-500 font-bold uppercase">مكافأة</p>
              <p className="font-mono text-emerald-700">+{fmtSYP(lastPayroll.bonusAmount)}</p>
            </div>
            <div>
              <p className="text-[10px] text-amber-500 font-bold uppercase">سلفة</p>
              <p className="font-mono text-amber-700">−{fmtSYP(lastPayroll.advanceAmount)}</p>
            </div>
            <div>
              <p className="text-[10px] text-blue-500 font-bold uppercase">الصافي</p>
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
            <table className="w-full text-sm">
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
                    <td className="px-3 py-2 font-mono text-xs">{fmtSyriaDate(p.weekStart)}</td>
                    <td className="px-3 py-2 text-center font-mono text-xs">{p.workedHours.toFixed(1)}</td>
                    <td className="px-3 py-2 text-center font-mono text-emerald-700">+{fmtSYP(p.bonusAmount)}</td>
                    <td className="px-3 py-2 text-center font-mono font-bold">{fmtSYP(p.netAmount)}</td>
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
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
