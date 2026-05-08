'use client'
import { useEffect, useState } from 'react'
import { CheckCircle, Clock, AlertTriangle, XCircle, ArrowUpRight, ArrowDownRight, Activity, Shield, Zap, Eye } from 'lucide-react'
import { DashboardModal } from './_components/DashboardModal'
import { Tx, AccountSummary, Stats, MetricAction, CategoryKind } from './_components/types'
import { loadCategoryTransactions, loadMetricTransactions, METRIC_TITLES } from './_components/detailsLoader'
import { FollowUpStatsWidget } from '../follow-ups/_components/FollowUpStatsWidget'

function fmt(n: number) { return n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ title: string; transactions: Tx[]; loading?: boolean } | null>(null)

  async function showCategoryDetails(currency: string, category: CategoryKind) {
    const titlePrefix = `${currency} — `
    const categoryTitle = category === 'internal' ? 'التحويلات الداخلية'
      : category === 'gross' ? 'الأرباح الإجمالية (عمليات مطابقة)'
      : category === 'waste' ? 'الهدر' : 'الزيادات'
    setModal({ title: titlePrefix + categoryTitle, transactions: [], loading: true })
    const allTxs = await loadCategoryTransactions(currency, category)
    setModal({ title: titlePrefix + categoryTitle, transactions: allTxs, loading: false })
  }

  useEffect(() => {
    fetch('/api/dashboard/stats')
      .then(r => r.json())
      .then(d => { if (d.success) setStats(d.data) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="space-y-6 page-enter">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => <div key={i} className="h-28 skeleton" />)}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <div key={i} className="h-32 skeleton" />)}
      </div>
      <div className="h-80 skeleton" />
    </div>
  )

  const restricted = stats?.isRestricted === true

  const totalOps = (stats?.totalMatched || 0) + (stats?.totalPendingSC || 0) + (stats?.totalPendingP || 0) + (stats?.totalDiscrepancy || 0) + (stats?.totalWaste || 0)
  const matchRate = totalOps > 0 ? ((stats?.totalMatched || 0) / totalOps * 100) : 0

  const metrics: Array<{ label: string; value: number; icon: React.ReactNode; gradient: string; bg: string; text: string; action?: MetricAction }> = [
    { label: 'مطابقة صحيحة', value: stats?.totalMatched || 0, icon: <CheckCircle size={18} />, gradient: 'from-emerald-400 to-emerald-600', bg: 'bg-emerald-500/10', text: 'text-emerald-600', action: 'matched' },
    { label: 'شام كاش فقط', value: stats?.totalPendingSC || 0, icon: <Clock size={18} />, gradient: 'from-amber-400 to-orange-500', bg: 'bg-amber-500/10', text: 'text-amber-600', action: 'pending_sc' },
    { label: 'المنصة فقط', value: stats?.totalPendingP || 0, icon: <Clock size={18} />, gradient: 'from-sky-400 to-blue-500', bg: 'bg-sky-500/10', text: 'text-sky-600', action: 'pending_p' },
    { label: 'فارق في المبلغ', value: stats?.totalDiscrepancy || 0, icon: <AlertTriangle size={18} />, gradient: 'from-rose-400 to-red-500', bg: 'bg-rose-500/10', text: 'text-rose-600', action: 'discrepancy' },
    { label: 'هدر', value: stats?.totalWaste || 0, icon: <XCircle size={18} />, gradient: 'from-gray-400 to-gray-500', bg: 'bg-gray-500/10', text: 'text-gray-500', action: 'waste' },
    { label: 'تحويلات داخلية', value: stats?.totalInternal || 0, icon: <ArrowUpRight size={18} />, gradient: 'from-purple-400 to-purple-600', bg: 'bg-purple-500/10', text: 'text-purple-600', action: 'internal' },
  ]

  async function showMetricDetails(action: MetricAction) {
    setModal({ title: METRIC_TITLES[action], transactions: [], loading: true })
    const txs = await loadMetricTransactions(action)
    setModal({ title: METRIC_TITLES[action], transactions: txs, loading: false })
  }

  return (
    <div className="space-y-6 page-enter">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-extrabold gradient-text dark:text-white">لوحة التحكم</h1>
          <p className="text-sm text-gray-400 mt-0.5">نظرة عامة على الحركة المالية</p>
        </div>
        {/* Profit highlight cards per currency - hidden for restricted */}
        {!restricted && (() => {
          const byCurrency = new Map<string, number>()
          for (const s of stats?.accountSummaries || []) {
            const cur = s.currency || 'USD'
            byCurrency.set(cur, (byCurrency.get(cur) || 0) + (s.netProfit || 0))
          }
          const currencies = Array.from(byCurrency.entries())
          return (
            <div className="flex items-center gap-3 flex-wrap">
              {currencies.map(([cur, netPro]) => (
                <div key={cur} className="relative overflow-hidden rounded-2xl px-5 py-3" style={{
                  background: netPro >= 0
                    ? 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(16,185,129,0.02) 100%)'
                    : 'linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(239,68,68,0.02) 100%)',
                  border: `1px solid ${netPro >= 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}`,
                }}>
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${netPro >= 0 ? 'bg-emerald-500/15' : 'bg-red-500/15'}`}>
                      {netPro >= 0 ? <ArrowUpRight size={18} className="text-emerald-500" /> : <ArrowDownRight size={18} className="text-red-500" />}
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">صافي الربح · {cur}</p>
                      <p className={`text-lg font-extrabold font-mono ${netPro >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fmt(netPro)} <span className="text-xs font-normal text-gray-500">{cur}</span>
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 stagger-in">
        {metrics.map((m, i) => (
          <div key={i} className="metric-card group relative">
            <div className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${m.gradient} opacity-80 group-hover:opacity-100 transition-opacity`} />
            <div className="flex items-center justify-between mb-3">
              <div className={`w-9 h-9 rounded-xl ${m.bg} flex items-center justify-center ${m.text}
                group-hover:scale-110 transition-transform duration-500`}>
                {m.icon}
              </div>
              {m.action && (
                <button onClick={() => showMetricDetails(m.action!)} className={`${m.text} hover:opacity-80 transition-opacity`} title="عرض العمليات">
                  <Eye size={14} />
                </button>
              )}
            </div>
            <p className={`text-2xl font-extrabold font-mono ${m.text}`}>
              {typeof m.value === 'number' ? m.value.toLocaleString('ar') : m.value}
            </p>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1.5">{m.label}</p>
          </div>
        ))}
      </div>

      {/* Highlight Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-in">
        {/* Total Operations */}
        <div className="dark-glass relative overflow-hidden group">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-blue-500/10 rounded-full blur-[40px] group-hover:bg-blue-500/15 transition-all duration-700" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <Activity size={16} className="text-blue-300" />
              <p className="text-[11px] font-bold text-blue-300/60 uppercase tracking-wider">إجمالي العمليات</p>
            </div>
            <p className="text-4xl font-extrabold font-mono text-white">{totalOps.toLocaleString('ar')}</p>
          </div>
        </div>

        {/* Match Rate */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-200/30 p-6 group" style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,0.95) 0%, rgba(5,150,105,0.95) 100%)',
        }}>
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/5 rounded-full blur-[30px] group-hover:bg-white/10 transition-all duration-700" />
          <div className="relative text-white">
            <div className="flex items-center gap-2 mb-3">
              <Shield size={16} className="text-emerald-100" />
              <p className="text-[11px] font-bold text-emerald-100/70 uppercase tracking-wider">نسبة المطابقة</p>
            </div>
            <p className="text-4xl font-extrabold font-mono">{matchRate.toFixed(1)}%</p>
            {/* Progress bar */}
            <div className="mt-3 h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white/60 rounded-full transition-all duration-1000" style={{ width: `${matchRate}%` }} />
            </div>
          </div>
        </div>

      </div>

      {/* Follow-up workflow widget */}
      <FollowUpStatsWidget mode="global" />

      {/* Per-currency profit cards - hidden for restricted */}
      {!restricted && (() => {
        const byCurrency = new Map<string, { gross: number; waste: number; extras: number; net: number; internalCount: number; internalAmount: number }>()
        for (const s of stats?.accountSummaries || []) {
          const cur = s.currency || 'USD'
          const existing = byCurrency.get(cur) || { gross: 0, waste: 0, extras: 0, net: 0, internalCount: 0, internalAmount: 0 }
          existing.gross += s.grossProfit || 0
          existing.waste += s.wasteAmount || 0
          existing.extras += s.extrasAmount || 0
          existing.net += s.netProfit || 0
          existing.internalCount += s.internalCount || 0
          existing.internalAmount += s.internalAmount || 0
          byCurrency.set(cur, existing)
        }
        const currencies = Array.from(byCurrency.entries())
        if (currencies.length === 0) return null
        const openCategory = (cur: string, category: CategoryKind) => {
          showCategoryDetails(cur, category)
        }
        return (
          <div className="space-y-3">
            {currencies.map(([cur, t]) => (
              <div key={cur} className="card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="badge bg-blue-50 text-blue-700 font-bold">{cur}</span>
                  <h3 className="text-sm font-medium text-gray-700">ملخص مالي</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="metric-card border-r-4 border-purple-400 relative">
                    <button onClick={() => openCategory(cur, 'internal')} className="absolute top-2 left-2 text-purple-500 hover:text-purple-700" title="عرض العمليات">
                      <Eye size={14} />
                    </button>
                    <p className="metric-label">التحويلات الداخلية</p>
                    <p className="metric-value text-purple-700 text-lg">{fmt(t.internalAmount)} {cur}</p>
                    <p className="text-[10px] text-gray-400 mt-1">{t.internalCount} عملية · خارج كل الحسابات</p>
                  </div>
                  <div className="metric-card border-r-4 border-emerald-500 relative">
                    <button onClick={() => openCategory(cur, 'gross')} className="absolute top-2 left-2 text-emerald-500 hover:text-emerald-700" title="عرض العمليات">
                      <Eye size={14} />
                    </button>
                    <p className="metric-label">إجمالي الأرباح</p>
                    <p className="metric-value text-emerald-600 text-lg">{fmt(t.gross)} {cur}</p>
                  </div>
                  <div className="metric-card border-r-4 border-red-400 relative">
                    <button onClick={() => openCategory(cur, 'waste')} className="absolute top-2 left-2 text-red-500 hover:text-red-700" title="عرض العمليات">
                      <Eye size={14} />
                    </button>
                    <p className="metric-label">الهدر</p>
                    <p className="metric-value text-red-600 text-lg">{fmt(t.waste)} {cur}</p>
                  </div>
                  <div className="metric-card border-r-4 border-amber-400 relative">
                    <button onClick={() => openCategory(cur, 'extras')} className="absolute top-2 left-2 text-amber-500 hover:text-amber-700" title="عرض العمليات">
                      <Eye size={14} />
                    </button>
                    <p className="metric-label">الزيادات</p>
                    <p className="metric-value text-amber-600 text-lg">{fmt(t.extras)} {cur}</p>
                  </div>
                  <div className="metric-card border-r-4 border-blue-600 relative">
                    <p className="metric-label">صافي الأرباح</p>
                    <p className={`metric-value text-lg ${t.net >= 0 ? 'text-blue-700' : 'text-red-700'}`}>{fmt(t.net)} {cur}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* Accounts Summary */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="font-bold text-gray-800 dark:text-gray-200">ملخص الحسابات</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">Accounts Summary</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>الحساب</th>
                {!restricted && <th>الأرباح الإجمالية</th>}
                {!restricted && <th>الهدر</th>}
                {!restricted && <th>الزيادات</th>}
                {!restricted && <th>الأرباح الصافية</th>}
                <th>عمليات صحيحة</th>
                <th>معلقة</th>
              </tr>
            </thead>
            <tbody>
              {!stats?.accountSummaries?.length ? (
                <tr><td colSpan={restricted ? 3 : 7} className="text-center py-12 text-gray-300">لا توجد حسابات</td></tr>
              ) : (
                <>
                  {(() => {
                    // Group by currency
                    const grouped = new Map<string, AccountSummary[]>()
                    for (const s of stats!.accountSummaries) {
                      const cur = s.currency || 'USD'
                      if (!grouped.has(cur)) grouped.set(cur, [])
                      grouped.get(cur)!.push(s)
                    }
                    const elements: React.ReactNode[] = []
                    for (const [cur, accounts] of grouped.entries()) {
                      if (grouped.size > 1) {
                        elements.push(
                          <tr key={`h-${cur}`} className="bg-gray-100">
                            <td colSpan={restricted ? 3 : 7}>
                              <span className="badge bg-blue-50 text-blue-700 font-bold">{cur}</span>
                            </td>
                          </tr>
                        )
                      }
                      for (const s of accounts) {
                        elements.push(
                          <tr key={s.accountId}>
                            <td className="font-semibold text-gray-800 dark:text-gray-200">{s.accountName}</td>
                            {!restricted && <td className="font-mono text-emerald-600 font-semibold">{fmt(s.grossProfit || 0)} {cur}</td>}
                            {!restricted && <td className="font-mono text-red-500">{fmt(s.wasteAmount || 0)} {cur}</td>}
                            {!restricted && <td className="font-mono text-amber-600">{fmt(s.extrasAmount || 0)} {cur}</td>}
                            {!restricted && <td className="font-mono font-bold text-gray-800 dark:text-gray-200">{fmt(s.netProfit || 0)} {cur}</td>}
                            <td>
                              <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                                <CheckCircle size={13} /> {s.matchedCount.toLocaleString('ar')}
                              </span>
                            </td>
                            <td>
                              {s.pendingCount > 0
                                ? <span className="badge badge-pending-sc">{s.pendingCount.toLocaleString('ar')}</span>
                                : <span className="text-gray-300">0</span>}
                            </td>
                          </tr>
                        )
                      }
                      if (!restricted) {
                        const tGross = accounts.reduce((s, a) => s + (a.grossProfit || 0), 0)
                        const tWaste = accounts.reduce((s, a) => s + (a.wasteAmount || 0), 0)
                        const tExtras = accounts.reduce((s, a) => s + (a.extrasAmount || 0), 0)
                        const tNet = accounts.reduce((s, a) => s + (a.netProfit || 0), 0)
                        const tMatched = accounts.reduce((s, a) => s + a.matchedCount, 0)
                        const tPending = accounts.reduce((s, a) => s + a.pendingCount, 0)
                        elements.push(
                          <tr key={`t-${cur}`} className="font-bold" style={{ background: 'rgba(250,251,252,0.8)' }}>
                            <td className="text-gray-700">مجموع {cur}</td>
                            <td className="font-mono text-emerald-600">{fmt(tGross)} {cur}</td>
                            <td className="font-mono text-red-500">{fmt(tWaste)} {cur}</td>
                            <td className="font-mono text-amber-600">{fmt(tExtras)} {cur}</td>
                            <td className={`font-mono ${tNet >= 0 ? 'text-gray-800' : 'text-red-600'}`}>{fmt(tNet)} {cur}</td>
                            <td className="font-semibold">{tMatched.toLocaleString('ar')}</td>
                            <td>{tPending.toLocaleString('ar')}</td>
                          </tr>
                        )
                      }
                    }
                    return elements
                  })()}
                  {!restricted && (
                    <tr style={{ background: 'rgba(245,158,11,0.04)' }}>
                      <td className="text-gray-500">الصرفيات الإجمالية <span className="text-[10px] text-gray-400">(غير مخصصة بعملة)</span></td>
                      <td colSpan={3} />
                      <td className="font-mono text-amber-600 font-semibold">-${fmt(stats.totalExpenses || 0)}</td>
                      <td colSpan={2} />
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent batches */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="font-bold text-gray-800 dark:text-gray-200">آخر عمليات الرفع</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">Recent Uploads</p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-50 text-amber-600">
            <Zap size={12} />
            <span className="text-[11px] font-bold">{stats?.recentBatches?.length || 0}</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>الحساب</th><th>تاريخ الدورة</th><th>الحالة</th><th>الصفوف المعالجة</th></tr>
            </thead>
            <tbody>
              {!stats?.recentBatches?.length ? (
                <tr><td colSpan={4} className="text-center py-12 text-gray-300">لا توجد عمليات رفع بعد</td></tr>
              ) : stats.recentBatches.map(b => (
                <tr key={b.id}>
                  <td className="font-semibold text-gray-700 dark:text-gray-300">{b.accountName}</td>
                  <td className="text-gray-500">{new Date(b.batchDate).toLocaleDateString('ar-SY')}</td>
                  <td>
                    <span className={`badge ${b.status === 'COMPLETED' ? 'badge-matched' : b.status === 'FAILED' ? 'badge-discrepancy' : 'badge-pending-sc'}`}>
                      {b.status === 'COMPLETED' ? 'مكتمل' : b.status === 'FAILED' ? 'فشل' : 'معالجة'}
                    </span>
                  </td>
                  <td className="font-mono text-gray-600">{b.rowsProcessed?.toLocaleString('ar') || '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {modal && (
        <DashboardModal
          title={modal.title}
          transactions={modal.transactions}
          loading={modal.loading}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
