'use client'
import { ProfitData, AccountProfit, fmt } from './types'

export function AllAccountsTable({ data }: { data: ProfitData | null }) {
  if ((data?.accounts.length || 0) <= 1) return null
  return (
    <div className="card overflow-hidden">
      <div className="card-header">
        <h2 className="font-semibold text-gray-800">ملخص جميع الحسابات</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>الحساب</th>
              <th>أرباح الإيداعات</th>
              <th>أرباح السحوبات</th>
              <th>إجمالي الأرباح</th>
              <th>الهدر</th>
              <th>الزيادات</th>
              <th>صافي الربح</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Group accounts by currency
              const grouped = new Map<string, AccountProfit[]>()
              for (const a of data?.accounts || []) {
                const cur = a.currency || 'USD'
                if (!grouped.has(cur)) grouped.set(cur, [])
                grouped.get(cur)!.push(a)
              }
              const elements: React.ReactNode[] = []
              for (const [cur, accounts] of grouped.entries()) {
                // Currency header row
                elements.push(
                  <tr key={`h-${cur}`} className="bg-gray-100">
                    <td colSpan={7} className="font-bold text-gray-700">
                      <span className="badge bg-blue-50 text-blue-700">{cur}</span>
                    </td>
                  </tr>
                )
                // Account rows
                for (const a of accounts) {
                  elements.push(
                    <tr key={a.accountId}>
                      <td className="font-medium">{a.accountName}</td>
                      <td className="font-mono text-green-700">{fmt(a.deposits.netProfit, a.currency)}</td>
                      <td className="font-mono text-blue-700">{fmt(a.withdrawals.netProfit, a.currency)}</td>
                      <td className="font-mono">{fmt(a.totalGrossProfit, a.currency)}</td>
                      <td className="font-mono text-red-600">{fmt(a.totalWaste, a.currency)}</td>
                      <td className="font-mono text-amber-600">{fmt(a.totalExtras, a.currency)}</td>
                      <td className={`font-mono font-bold ${a.totalNetProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {fmt(a.totalNetProfit, a.currency)}
                      </td>
                    </tr>
                  )
                }
                // Currency totals row
                const totGross = accounts.reduce((s, a) => s + a.totalGrossProfit, 0)
                const totWaste = accounts.reduce((s, a) => s + a.totalWaste, 0)
                const totExtras = accounts.reduce((s, a) => s + a.totalExtras, 0)
                const totNet = accounts.reduce((s, a) => s + a.totalNetProfit, 0)
                elements.push(
                  <tr key={`t-${cur}`} className="bg-blue-50 font-bold">
                    <td>مجموع {cur}</td>
                    <td />
                    <td />
                    <td className="font-mono">{fmt(totGross, cur)}</td>
                    <td className="font-mono text-red-600">{fmt(totWaste, cur)}</td>
                    <td className="font-mono text-amber-600">{fmt(totExtras, cur)}</td>
                    <td className={`font-mono ${totNet >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(totNet, cur)}</td>
                  </tr>
                )
              }
              return elements
            })()}
            <tr className="bg-gray-50">
              <td colSpan={6} className="text-gray-600">الصرفيات الإجمالية <span className="text-[10px] text-gray-400">(غير مخصصة بعملة)</span></td>
              <td className="font-mono text-red-600 font-bold">-${(data?.totalExpenses || 0).toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
