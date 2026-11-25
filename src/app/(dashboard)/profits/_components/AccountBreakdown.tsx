'use client'
import { TrendingUp, TrendingDown, Eye } from 'lucide-react'
import { AccountProfit, fmt } from './types'

function ProfitRow({ label, amount, currency, highlight, onShowDetails }: {
  label: string; amount: number; currency: string; highlight?: 'green' | 'red' | 'amber'
  onShowDetails?: () => void
}) {
  return (
    <div className={`flex justify-between items-center py-2 px-4 rounded-lg ${
      highlight === 'green' ? 'bg-green-50' : highlight === 'red' ? 'bg-red-50' : highlight === 'amber' ? 'bg-amber-50' : 'bg-gray-50'
    }`}>
      <div className="flex items-center gap-2">
        <span className={`text-sm ${highlight === 'amber' ? 'text-amber-700' : 'text-gray-600'}`}>{label}</span>
        {onShowDetails && (
          <button onClick={onShowDetails} className="text-brand-600 hover:text-brand-800 transition-colors" title="عرض التفاصيل">
            <Eye size={14} />
          </button>
        )}
      </div>
      <span className={`font-mono font-semibold text-sm ${
        highlight === 'green' ? 'text-green-700' : highlight === 'red' ? 'text-red-700' : highlight === 'amber' ? 'text-amber-700' : 'text-gray-800'
      }`}>{fmt(amount, currency)}</span>
    </div>
  )
}

function BreakdownRow({ label, amount, currency, onShowDetails }: {
  label: string; amount: number; currency: string
  onShowDetails?: () => void
}) {
  return (
    <div className="flex justify-between items-center text-xs text-gray-500 py-1">
      <div className="flex items-center gap-1.5">
        <span>{label}</span>
        {onShowDetails && (
          <button onClick={onShowDetails} className="text-brand-600 hover:text-brand-800 transition-colors" title="عرض العمليات">
            <Eye size={12} />
          </button>
        )}
      </div>
      <span className="font-mono">{fmt(amount, currency)}</span>
    </div>
  )
}

export function AccountBreakdown({
  account,
  onShowDetails,
}: {
  account: AccountProfit
  onShowDetails: (accountId: string, filters: Record<string, string>, title: string) => void
}) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="font-semibold text-gray-800">{account.accountName}</h2>
        <span className="text-sm text-gray-500">{account.currency}</span>
      </div>
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Deposits */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-green-600" />
            <h3 className="font-medium text-gray-700">الإيداعات ({account.deposits.profitRate}%)</h3>
          </div>
          <ProfitRow
            label={`عمليات مطابقة (${account.deposits.matched})`}
            amount={account.deposits.matchedAmount}
            currency={account.currency}
            onShowDetails={() => onShowDetails(account.accountId, { type: 'DEPOSIT', status: 'MATCHED', currency: account.currency }, `${account.accountName} — إيداعات مطابقة (${account.currency})`)}
          />
          <ProfitRow label="أرباح إجمالية" amount={account.deposits.grossProfit} currency={account.currency} highlight="green" />
          <ProfitRow label="هدر" amount={account.deposits.waste} currency={account.currency} highlight="red" />
          {/* Waste breakdown */}
          {account.deposits.wasteBreakdown && account.deposits.waste > 0 && (
            <div className="mr-4 border-r-2 border-red-200 pr-3">
              {(account.deposits.wasteBreakdown.platformOnly || 0) > 0 && (
                <BreakdownRow
                  label="المنصة فقط"
                  amount={account.deposits.wasteBreakdown.platformOnly!}
                  currency={account.currency}
                  onShowDetails={() => onShowDetails(account.accountId, { type: 'DEPOSIT', status: 'PENDING_P', source: 'PLATFORM', currency: account.currency }, `${account.accountName} — إيداعات المنصة فقط (${account.currency})`)}
                />
              )}
              {(account.deposits.wasteBreakdown.discrepancyPHigher || 0) > 0 && (
                <BreakdownRow
                  label="فارق المنصة أكبر"
                  amount={account.deposits.wasteBreakdown.discrepancyPHigher!}
                  currency={account.currency}
                  onShowDetails={() => onShowDetails(account.accountId, { type: 'DEPOSIT', status: 'DISCREPANCY', source: 'PLATFORM', currency: account.currency }, `${account.accountName} — إيداعات فارق المنصة أكبر (${account.currency})`)}
                />
              )}
            </div>
          )}
          {/* Extras for deposits */}
          {account.deposits.extras > 0 && (
            <>
              <ProfitRow label="الزيادات" amount={account.deposits.extras} currency={account.currency} highlight="amber" />
              {account.deposits.extrasBreakdown && (
                <div className="mr-4 border-r-2 border-amber-200 pr-3">
                  {(account.deposits.extrasBreakdown.scOnly || 0) > 0 && (
                    <BreakdownRow
                      label="شام كاش فقط"
                      amount={account.deposits.extrasBreakdown.scOnly!}
                      currency={account.currency}
                      onShowDetails={() => onShowDetails(account.accountId, { type: 'DEPOSIT', status: 'PENDING_SC', currency: account.currency }, `${account.accountName} — إيداعات شام كاش فقط (${account.currency})`)}
                    />
                  )}
                  {(account.deposits.extrasBreakdown.discrepancySCHigher || 0) > 0 && (
                    <BreakdownRow
                      label="فارق شام كاش أكبر"
                      amount={account.deposits.extrasBreakdown.discrepancySCHigher!}
                      currency={account.currency}
                      onShowDetails={() => onShowDetails(account.accountId, { type: 'DEPOSIT', status: 'DISCREPANCY', source: 'SHAM_CASH', currency: account.currency }, `${account.accountName} — إيداعات فارق شام كاش أكبر (${account.currency})`)}
                    />
                  )}
                </div>
              )}
            </>
          )}
          <ProfitRow label="أرباح صافية" amount={account.deposits.netProfit} currency={account.currency} highlight={account.deposits.netProfit >= 0 ? 'green' : 'red'} />
        </div>
        {/* Withdrawals */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown size={16} className="text-blue-600" />
            <h3 className="font-medium text-gray-700">السحوبات ({account.withdrawals.profitRate}%)</h3>
          </div>
          <ProfitRow
            label={`عمليات مطابقة (${account.withdrawals.matched})`}
            amount={account.withdrawals.matchedAmount}
            currency={account.currency}
            onShowDetails={() => onShowDetails(account.accountId, { type: 'WITHDRAWAL', status: 'MATCHED', currency: account.currency }, `${account.accountName} — سحوبات مطابقة (${account.currency})`)}
          />
          <ProfitRow label="أرباح إجمالية" amount={account.withdrawals.grossProfit} currency={account.currency} highlight="green" />
          <ProfitRow label="هدر" amount={account.withdrawals.waste} currency={account.currency} highlight="red" />
          {/* Waste breakdown */}
          {account.withdrawals.wasteBreakdown && account.withdrawals.waste > 0 && (
            <div className="mr-4 border-r-2 border-red-200 pr-3">
              {(account.withdrawals.wasteBreakdown.scOnly || 0) > 0 && (
                <BreakdownRow
                  label="شام كاش فقط"
                  amount={account.withdrawals.wasteBreakdown.scOnly!}
                  currency={account.currency}
                  onShowDetails={() => onShowDetails(account.accountId, { type: 'WITHDRAWAL', status: 'PENDING_SC', currency: account.currency }, `${account.accountName} — سحوبات شام كاش فقط (${account.currency})`)}
                />
              )}
              {(account.withdrawals.wasteBreakdown.discrepancySCHigher || 0) > 0 && (
                <BreakdownRow
                  label="فارق شام كاش أكبر"
                  amount={account.withdrawals.wasteBreakdown.discrepancySCHigher!}
                  currency={account.currency}
                  onShowDetails={() => onShowDetails(account.accountId, { type: 'WITHDRAWAL', status: 'DISCREPANCY', source: 'SHAM_CASH', currency: account.currency }, `${account.accountName} — سحوبات فارق شام كاش أكبر (${account.currency})`)}
                />
              )}
            </div>
          )}
          {/* Extras for withdrawals */}
          {account.withdrawals.extras > 0 && (
            <>
              <ProfitRow label="الزيادات" amount={account.withdrawals.extras} currency={account.currency} highlight="amber" />
              {account.withdrawals.extrasBreakdown && (
                <div className="mr-4 border-r-2 border-amber-200 pr-3">
                  {(account.withdrawals.extrasBreakdown.platformOnly || 0) > 0 && (
                    <BreakdownRow
                      label="المنصة فقط"
                      amount={account.withdrawals.extrasBreakdown.platformOnly!}
                      currency={account.currency}
                      onShowDetails={() => onShowDetails(account.accountId, { type: 'WITHDRAWAL', status: 'PENDING_P', currency: account.currency }, `${account.accountName} — سحوبات المنصة فقط (${account.currency})`)}
                    />
                  )}
                  {(account.withdrawals.extrasBreakdown.discrepancyPHigher || 0) > 0 && (
                    <BreakdownRow
                      label="فارق المنصة أكبر"
                      amount={account.withdrawals.extrasBreakdown.discrepancyPHigher!}
                      currency={account.currency}
                      onShowDetails={() => onShowDetails(account.accountId, { type: 'WITHDRAWAL', status: 'DISCREPANCY', source: 'PLATFORM', currency: account.currency }, `${account.accountName} — سحوبات فارق المنصة أكبر (${account.currency})`)}
                    />
                  )}
                </div>
              )}
            </>
          )}
          <ProfitRow label="أرباح صافية" amount={account.withdrawals.netProfit} currency={account.currency} highlight={account.withdrawals.netProfit >= 0 ? 'green' : 'red'} />
        </div>
      </div>
      {/* Total row */}
      <div className="px-6 pb-5">
        <div className="border-t border-gray-100 pt-4 flex justify-between items-center">
          <span className="font-semibold text-gray-700">صافي الربح الإجمالي للحساب</span>
          <span className={`font-bold text-lg font-mono ${account.totalNetProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {fmt(account.totalNetProfit, account.currency)}
          </span>
        </div>
      </div>
    </div>
  )
}
