'use client'

import { useEffect, useState, useCallback } from 'react'
import { ProfitData, CategoryKind } from './_components/types'
import { TransactionDetailModal } from './_components/TransactionDetailModal'
import { PeriodSelector } from './_components/PeriodSelector'
import { SummaryCards } from './_components/SummaryCards'
import { AccountBreakdown } from './_components/AccountBreakdown'
import { AllAccountsTable } from './_components/AllAccountsTable'

export default function ProfitsPage() {
  const [data, setData] = useState<ProfitData | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [detailModal, setDetailModal] = useState<{
    title: string
    query: string
  } | null>(null)
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    try {
      const response = await fetch(`/api/profits?${params}`, { cache: 'no-store' })
      if (response.status === 403) {
        setForbidden(true)
        return
      }
      const payload = await response.json()
      if (payload.success) setData(payload.data)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { void load() }, [load])

  async function showDetails(accountId: string, filters: Record<string, string>, title: string) {
    const params = new URLSearchParams({ accountId, ...filters, excludeWalletTransfers: '1' })
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    setDetailModal({ title, query: params.toString() })
  }

  async function showCategoryDetails(currency: string, category: CategoryKind) {
    const categoryTitle = category === 'internal' ? 'التحويلات الداخلية'
      : category === 'gross' ? 'الأرباح الإجمالية (عمليات مطابقة)'
      : category === 'waste' ? 'الهدر' : 'الزيادات'
    const title = `${currency} — ${categoryTitle}`

    const params = new URLSearchParams({ currency, category })
    if (category === 'gross') params.set('status', 'MATCHED')
    if (category !== 'internal') params.set('excludeWalletTransfers', '1')
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)

    setDetailModal({ title, query: params.toString() })
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-7 w-32 rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="card p-5 space-y-3">
              <div className="skeleton h-3 w-24 rounded-lg" />
              <div className="skeleton h-8 w-32 rounded-lg" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="card p-5 space-y-3">
              <div className="skeleton h-5 w-40 rounded-lg" />
              <div className="skeleton h-24 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (forbidden) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-xl font-bold text-gray-600 mb-2">غير مصرح بالوصول</p>
          <p className="text-gray-400">ليس لديك صلاحية لعرض هذه الصفحة</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">الأرباح</h1>
          <p className="text-sm text-gray-500 mt-0.5">Profits</p>
        </div>
        <PeriodSelector dateFrom={dateFrom} dateTo={dateTo} setDateFrom={setDateFrom} setDateTo={setDateTo} />
      </div>

      <SummaryCards data={data} onShowCategory={showCategoryDetails} />

      <div className="space-y-4">
        {data?.accounts.map(account => (
          <AccountBreakdown key={account.accountId} account={account} onShowDetails={showDetails} />
        ))}
      </div>

      <AllAccountsTable data={data} />

      {detailModal && (
        <TransactionDetailModal
          title={detailModal.title}
          query={detailModal.query}
          onClose={() => setDetailModal(null)}
        />
      )}
    </div>
  )
}
