'use client'
import { Eye } from 'lucide-react'
import { ProfitData, fmt, CategoryKind } from './types'

export function SummaryCards({
  data,
  onShowCategory,
}: {
  data: ProfitData | null
  onShowCategory: (currency: string, category: CategoryKind) => void
}) {
  const byCurrency = new Map<string, { netProfit: number; extras: number; grossProfit: number; waste: number; internalCount: number; internalAmount: number }>()
  for (const a of data?.accounts || []) {
    const cur = a.currency || 'USD'
    const existing = byCurrency.get(cur) || { netProfit: 0, extras: 0, grossProfit: 0, waste: 0, internalCount: 0, internalAmount: 0 }
    existing.netProfit += a.totalNetProfit || 0
    existing.extras += a.totalExtras || 0
    existing.grossProfit += a.totalGrossProfit || 0
    existing.waste += a.totalWaste || 0
    existing.internalCount += a.internalTransfers?.totalCount || 0
    existing.internalAmount += a.internalTransfers?.totalAmount || 0
    byCurrency.set(cur, existing)
  }
  const currencies = Array.from(byCurrency.entries())
  if (currencies.length === 0) currencies.push(['USD', { netProfit: 0, extras: 0, grossProfit: 0, waste: 0, internalCount: 0, internalAmount: 0 }])

  return (
    <div className="space-y-3">
      {currencies.map(([cur, t]) => (
        <div key={cur} className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="badge bg-blue-50 text-blue-700 font-bold">{cur}</span>
            <h3 className="text-sm font-medium text-gray-700">ملخص {cur}</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="metric-card border-r-4 border-purple-400 relative">
              <button onClick={() => onShowCategory(cur, 'internal')} className="absolute top-2 left-2 text-purple-500 hover:text-purple-700" title="عرض العمليات">
                <Eye size={14} />
              </button>
              <p className="metric-label">التحويلات الداخلية</p>
              <p className="metric-value text-purple-700 text-lg">{fmt(t.internalAmount, cur)}</p>
              <p className="text-[10px] text-gray-400 mt-1">{t.internalCount} عملية · خارج كل الحسابات</p>
            </div>
            <div className="metric-card border-r-4 border-blue-600 relative">
              <button onClick={() => onShowCategory(cur, 'gross')} className="absolute top-2 left-2 text-blue-500 hover:text-blue-700" title="عرض العمليات">
                <Eye size={14} />
              </button>
              <p className="metric-label">الأرباح الإجمالية</p>
              <p className="metric-value text-blue-700 text-lg">{fmt(t.grossProfit, cur)}</p>
            </div>
            <div className="metric-card border-r-4 border-red-400 relative">
              <button onClick={() => onShowCategory(cur, 'waste')} className="absolute top-2 left-2 text-red-500 hover:text-red-700" title="عرض العمليات">
                <Eye size={14} />
              </button>
              <p className="metric-label">الهدر</p>
              <p className="metric-value text-red-600 text-lg">{fmt(t.waste, cur)}</p>
            </div>
            <div className="metric-card border-r-4 border-amber-400 relative">
              <button onClick={() => onShowCategory(cur, 'extras')} className="absolute top-2 left-2 text-amber-500 hover:text-amber-700" title="عرض العمليات">
                <Eye size={14} />
              </button>
              <p className="metric-label">الزيادات</p>
              <p className="metric-value text-amber-600 text-lg">{fmt(t.extras, cur)}</p>
              <p className="text-[10px] text-gray-400 mt-1">خارج صافي الربح</p>
            </div>
            <div className="metric-card border-r-4 border-green-500 relative">
              <p className="metric-label">صافي الأرباح</p>
              <p className="metric-value text-green-600 text-lg">{fmt(t.netProfit, cur)}</p>
            </div>
          </div>
        </div>
      ))}
      {/* Expenses card (global, no currency) */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="badge bg-gray-100 text-gray-600 text-xs">عام</span>
          <h3 className="text-sm font-medium text-gray-700">الصرفيات الإجمالية</h3>
          <span className="text-xs text-gray-400">(غير مخصصة بعملة محددة)</span>
        </div>
        <div className="metric-card border-r-4 border-red-400 max-w-xs">
          <p className="metric-label">إجمالي الصرفيات</p>
          <p className="metric-value text-red-600">${(data?.totalExpenses || 0).toLocaleString('en', { minimumFractionDigits: 2 })}</p>
        </div>
      </div>
    </div>
  )
}
