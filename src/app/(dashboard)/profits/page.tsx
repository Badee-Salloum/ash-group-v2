'use client'
import { useEffect, useState, useCallback } from 'react'
import { ProfitData, Transaction, AccountProfit, CategoryKind } from './_components/types'
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
  const [detailModal, setDetailModal] = useState<{ title: string; transactions: Transaction[]; loading?: boolean } | null>(null)
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    const res = await fetch(`/api/profits?${params}`)
    if (res.status === 403) { setForbidden(true); setLoading(false); return }
    const d = await res.json()
    if (d.success) setData(d.data)
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])


  async function showDetails(accountId: string, filters: Record<string, string>, title: string) {
    const params = new URLSearchParams({ accountId, pageSize: '10000', ...filters })
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    const res = await fetch(`/api/transactions?${params}`)
    const d = await res.json()
    if (d.success) {
      let txs = d.data as Transaction[]

      // Filter out internal transfers based on wallet identifiers
      const account = data?.accounts.find((a: AccountProfit) => a.accountId === accountId)
      if (account) {
        // Fetch account's wallet identifiers
        const accRes = await fetch('/api/accounts')
        const accData = await accRes.json()
        if (accData.success) {
          const fullAccount = accData.data.find((a: { id: string; walletIdentifiers?: string[] }) => a.id === accountId)
          const walletIds: string[] = fullAccount?.walletIdentifiers || []
          if (walletIds.length > 0 && (filters.status === 'PENDING_SC')) {
            txs = txs.filter(tx => {
              const raw = tx.rawData as Record<string, unknown> | null
              if (!raw) return true
              const text = `${raw.accountNumber || ''} ${raw.accountName || ''} ${raw.notes || ''}`.toLowerCase()
              const isInternal = walletIds.some(wid => {
                const words = wid.trim().split(/\s+/).filter(Boolean)
                if (words.length === 0) return false
                const textTokens = new Set(text.split(/\s+/).filter(Boolean))
                return words.every(word => {
                  const w = word.toLowerCase()
                  return w.length >= 2 ? text.includes(w) : textTokens.has(w)
                })
              })
              return !isInternal
            })
          }
        }
      }

      setDetailModal({ title, transactions: txs })
    }
  }

  // Show ALL transactions for a given category (internal/gross/waste/extras) and currency (across all accounts)
  async function showCategoryDetails(currency: string, category: CategoryKind) {
    // Show loading modal immediately
    const titlePrefix = `${currency} — `
    const categoryTitle = category === 'internal' ? 'التحويلات الداخلية'
      : category === 'gross' ? 'الأرباح الإجمالية (عمليات مطابقة)'
      : category === 'waste' ? 'الهدر' : 'الزيادات'
    setDetailModal({ title: titlePrefix + categoryTitle, transactions: [], loading: true })

    const baseParams = new URLSearchParams({ currency, pageSize: '10000' })
    if (dateFrom) baseParams.set('dateFrom', dateFrom)
    if (dateTo) baseParams.set('dateTo', dateTo)

    // Get wallet identifiers from all accounts (combine all)
    const accRes = await fetch('/api/accounts')
    const accData = await accRes.json()
    const allWalletIds: string[] = accData.success
      ? accData.data.flatMap((a: { walletIdentifiers?: string[] }) => a.walletIdentifiers || [])
      : []
    const walletIds = allWalletIds

    const matchesWallet = (raw: Record<string, unknown> | null) => {
      if (!raw) return false
      const text = `${raw.accountNumber || ''} ${raw.accountName || ''} ${raw.notes || ''}`.toLowerCase()
      return walletIds.some(wid => {
        const words = wid.trim().split(/\s+/).filter(Boolean)
        if (words.length === 0) return false
        const textTokens = new Set(text.split(/\s+/).filter(Boolean))
        return words.every(word => {
          const w = word.toLowerCase()
          return w.length >= 2 ? text.includes(w) : textTokens.has(w)
        })
      })
    }

    const fetchFiltered = async (params: URLSearchParams): Promise<Transaction[]> => {
      const r = await fetch(`/api/transactions?${params}`)
      const j = await r.json()
      return j.success ? (j.data as Transaction[]) : []
    }

    let allTxs: Transaction[] = []
    let title = `${currency} — `

    if (category === 'internal') {
      title += 'التحويلات الداخلية'
      const p = new URLSearchParams(baseParams); p.set('status', 'PENDING_SC'); p.set('source', 'SHAM_CASH')
      const rows = await fetchFiltered(p)
      allTxs = rows.filter(t => matchesWallet(t.rawData as Record<string, unknown> | null))
    } else if (category === 'gross') {
      title += 'الأرباح الإجمالية (عمليات مطابقة)'
      const p = new URLSearchParams(baseParams); p.set('status', 'MATCHED')
      allTxs = await fetchFiltered(p)
    } else if (category === 'waste') {
      title += 'الهدر'
      // Deposit PENDING_P PLATFORM + Deposit DISCREPANCY PLATFORM + Withdrawal DISCREPANCY SHAM_CASH + Withdrawal PENDING_SC (excluding internal)
      const p1 = new URLSearchParams(baseParams); p1.set('type', 'DEPOSIT'); p1.set('status', 'PENDING_P'); p1.set('source', 'PLATFORM')
      const p2 = new URLSearchParams(baseParams); p2.set('type', 'DEPOSIT'); p2.set('status', 'DISCREPANCY'); p2.set('source', 'PLATFORM')
      const p3 = new URLSearchParams(baseParams); p3.set('type', 'WITHDRAWAL'); p3.set('status', 'DISCREPANCY'); p3.set('source', 'SHAM_CASH')
      const p4 = new URLSearchParams(baseParams); p4.set('type', 'WITHDRAWAL'); p4.set('status', 'PENDING_SC')
      const [r1, r2, r3, r4] = await Promise.all([fetchFiltered(p1), fetchFiltered(p2), fetchFiltered(p3), fetchFiltered(p4)])
      // Filter wd PENDING_SC to exclude internal
      const r4Filtered = walletIds.length > 0 ? r4.filter(t => !matchesWallet(t.rawData as Record<string, unknown> | null)) : r4
      allTxs = [...r1, ...r2, ...r3, ...r4Filtered]
    } else if (category === 'extras') {
      title += 'الزيادات'
      // Deposit PENDING_SC (excluding internal) + Deposit DISCREPANCY SHAM_CASH + Withdrawal PENDING_P + Withdrawal DISCREPANCY PLATFORM
      const p1 = new URLSearchParams(baseParams); p1.set('type', 'DEPOSIT'); p1.set('status', 'PENDING_SC')
      const p2 = new URLSearchParams(baseParams); p2.set('type', 'DEPOSIT'); p2.set('status', 'DISCREPANCY'); p2.set('source', 'SHAM_CASH')
      const p3 = new URLSearchParams(baseParams); p3.set('type', 'WITHDRAWAL'); p3.set('status', 'PENDING_P')
      const p4 = new URLSearchParams(baseParams); p4.set('type', 'WITHDRAWAL'); p4.set('status', 'DISCREPANCY'); p4.set('source', 'PLATFORM')
      const [r1, r2, r3, r4] = await Promise.all([fetchFiltered(p1), fetchFiltered(p2), fetchFiltered(p3), fetchFiltered(p4)])
      const r1Filtered = walletIds.length > 0 ? r1.filter(t => !matchesWallet(t.rawData as Record<string, unknown> | null)) : r1
      allTxs = [...r1Filtered, ...r2, ...r3, ...r4]
    }

    // Sort by date desc
    allTxs.sort((a, b) => new Date(b.txDateTime).getTime() - new Date(a.txDateTime).getTime())
    setDetailModal({ title, transactions: allTxs })
  }

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-gray-400">جاري التحميل...</p></div>

  if (forbidden) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <p className="text-xl font-bold text-gray-600 mb-2">غير مصرح بالوصول</p>
        <p className="text-gray-400">ليس لديك صلاحية لعرض هذه الصفحة</p>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">الأرباح</h1>
          <p className="text-sm text-gray-500 mt-0.5">Profits</p>
        </div>
        <PeriodSelector dateFrom={dateFrom} dateTo={dateTo} setDateFrom={setDateFrom} setDateTo={setDateTo} />
      </div>

      {/* Summary cards per currency */}
      <SummaryCards data={data} onShowCategory={showCategoryDetails} />

      {/* Per-account breakdown */}
      <div className="space-y-4">
        {data?.accounts.map(account => (
          <AccountBreakdown key={account.accountId} account={account} onShowDetails={showDetails} />
        ))}
      </div>

      {/* All accounts total table */}
      <AllAccountsTable data={data} />

      {/* Detail Modal */}
      {detailModal && (
        <TransactionDetailModal
          title={detailModal.title}
          transactions={detailModal.transactions}
          loading={detailModal.loading}
          onClose={() => setDetailModal(null)}
        />
      )}
    </div>
  )
}
