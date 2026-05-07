'use client'
import { useEffect, useState, useCallback } from 'react'
import DataTable from '@/components/tables/DataTable'
import { Transaction, Filters, MatchInfoMap } from './_components/types'
import { EditModal } from './_components/EditModal'
import { FilterBar } from './_components/FilterBar'
import { buildColumns } from './_components/columns'
import { makeMatchesWallet } from './_components/walletMatch'

export default function ReconciliationPage() {
  const [data, setData] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<Filters>({
    status: '', type: '', accountId: '', currency: '', dateFrom: '', dateTo: '',
    reviewed: '', reviewCategory: '',
  })
  const [availableCurrencies, setAvailableCurrencies] = useState<string[]>([])
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 })
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  // Reconciliation page always shows full data to SUPERVISOR & ACCOUNT_MGR.
  // Financial restrictions only apply to dashboard/accounts/profits pages.
  const restricted = false
  const _setRestricted = (_v: boolean) => {}
  void _setRestricted
  const [matchInfo, setMatchInfo] = useState<MatchInfoMap>({})

  useEffect(() => {
    fetch('/api/accounts').then(r => r.json()).then(d => {
      if (d.success) setAccounts(d.data)
    })
    fetch('/api/dashboard/stats').then(r => r.json()).then(d => {
      void d // ignored; reconciliation page always shows full data
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v))
    params.set('pageSize', '10000')
    const res = await fetch(`/api/transactions?${params}`)
    const d = await res.json()
    if (d.success) {
      let filteredData = d.data as Transaction[]
      let filteredTotal = d.meta.total

      // Always exclude wallet-internal transfers (our own wallet identifiers)
      // from the reconciliation view — they should never appear as customer ops.
      {
        const accRes = await fetch('/api/accounts')
        const accData = await accRes.json()
        const allWalletIds: string[] = accData.success
          ? accData.data.flatMap((a: { walletIdentifiers?: string[] }) => a.walletIdentifiers || [])
          : []
        if (allWalletIds.length > 0) {
          const matchesWallet = makeMatchesWallet(allWalletIds)
          const before = filteredData.length
          // Only filter PENDING_SC rows — MATCHED / DISCREPANCY / PENDING_P
          // might legitimately reference wallet names as the counterparty.
          filteredData = filteredData.filter((t: Transaction) => {
            if (t.status !== 'PENDING_SC') return true
            return !matchesWallet(t.rawData as Record<string, unknown> | null)
          })
          filteredTotal = filteredTotal - (before - filteredData.length)
        }
      }

      // Extract distinct currencies for filter dropdown
      const currencies = Array.from(new Set(filteredData.map((t: Transaction) => t.currency).filter(Boolean))) as string[]
      setAvailableCurrencies(currencies.sort())

      setData(filteredData); setMeta({ ...d.meta, total: filteredTotal })
      // Fetch best-match info for all PENDING transactions
      const pendingIds = filteredData
        .filter((t: Transaction) => t.status === 'PENDING_SC' || t.status === 'PENDING_P')
        .map((t: Transaction) => t.id)
      if (pendingIds.length > 0) {
        fetch('/api/reconciliation/bulk-match-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactionIds: pendingIds }),
        })
          .then(r => r.json())
          .then(m => { if (m.success) setMatchInfo(m.data) })
          .catch(() => {})
      }
    }
    setLoading(false)
  }, [filters])

  useEffect(() => { load() }, [load])

  const columns = buildColumns({ data, restricted, matchInfo, setEditTx, reload: load })

  // Compute totals per currency from displayed data
  const currencyTotals = data.reduce((acc: Record<string, number>, t) => {
    const cur = (t.currency as string) || 'USD'
    acc[cur] = (acc[cur] || 0) + Number(t.amount || 0)
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">المطابقة</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Reconciliation — <span className="font-semibold text-gray-700">{data.length.toLocaleString('ar')}</span> عملية معروضة
            {meta.total > data.length && (
              <span className="text-gray-400"> من أصل {meta.total.toLocaleString('ar')}</span>
            )}
          </p>
        </div>
        {!restricted && Object.keys(currencyTotals).length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(currencyTotals).map(([cur, total]) => (
              <div key={cur} className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2">
                <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">محصل {cur}</p>
                <p className="text-lg font-mono font-bold text-blue-700">
                  {total.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {cur}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <FilterBar
        filters={filters}
        setFilters={setFilters}
        accounts={accounts}
        availableCurrencies={availableCurrencies}
      />

      <DataTable
        data={data as unknown as Record<string, unknown>[]}
        columns={columns}
        loading={loading}
        exportFilename="reconciliation"
        excelExportUrl={`/api/transactions/export?${new URLSearchParams(Object.entries(filters).filter(([,v]) => v)).toString()}`}
        emptyMessage="لا توجد عمليات تطابق الفلاتر المحددة"
      />

      {/* Edit Modal */}
      {editTx && (
        <EditModal
          tx={editTx}
          onClose={() => setEditTx(null)}
          onSaved={() => { setEditTx(null); load() }}
        />
      )}
    </div>
  )
}
