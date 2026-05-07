'use client'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { fmtSyria } from '@/lib/datetime'
import { Transaction, STATUS_LABELS, STATUS_COLORS } from './types'

export function TransactionDetailModal({ title, transactions, loading, onClose }: {
  title: string
  transactions: Transaction[]
  loading?: boolean
  onClose: () => void
}) {
  const [page, setPage] = useState(1)
  const pageSize = 50
  const totalPages = Math.max(1, Math.ceil(transactions.length / pageSize))
  const startIdx = (page - 1) * pageSize
  const pagedTxs = transactions.slice(startIdx, startIdx + pageSize)

  // Reset page when transactions change
  useEffect(() => { setPage(1) }, [transactions.length, title])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col m-4 animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="overflow-auto flex-1 p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <Loader2 size={32} className="animate-spin text-brand-600" />
              <p className="text-sm text-gray-500">جاري تحميل العمليات...</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>اسم الحساب</th>
                  <th>النوع</th>
                  <th>الحالة</th>
                  <th>المصدر</th>
                  <th>رقم شام كاش</th>
                  <th>رقم المنصة</th>
                  <th>User ID</th>
                  <th>المبلغ</th>
                  <th>الفارق</th>
                </tr>
              </thead>
              <tbody>
                {pagedTxs.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-8 text-gray-400">لا توجد عمليات</td></tr>
                ) : pagedTxs.map(tx => {
                  const raw = tx.rawData as Record<string, unknown> | null
                  const sc = raw?.sc as Record<string, unknown> | undefined
                  const matchedRaw = (tx as unknown as { matchedTx?: { rawData?: Record<string, unknown> | null } }).matchedTx?.rawData as Record<string, unknown> | null | undefined
                  const accountName = (raw?.accountName as string) || (sc?.accountName as string) || (matchedRaw?.accountName as string) || '—'
                  return (
                  <tr key={tx.id}>
                    <td className="text-xs font-mono">{fmtSyria(tx.txDateTime)}</td>
                    <td className="text-sm font-medium">{accountName}</td>
                    <td className="text-sm">{tx.type === 'DEPOSIT' ? 'إيداع' : 'سحب'}</td>
                    <td>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[tx.status] || ''}`}>
                        {STATUS_LABELS[tx.status] || tx.status}
                      </span>
                    </td>
                    <td className="text-xs">{tx.source === 'SHAM_CASH' ? 'شام كاش' : 'المنصة'}</td>
                    <td className="font-mono text-xs">{tx.shamCashTxId || '—'}</td>
                    <td className="font-mono text-xs">{tx.platformTxId || '—'}</td>
                    <td className="font-mono text-xs">{tx.platformUserId || '—'}</td>
                    <td className="font-mono font-medium">{Number(tx.amount).toLocaleString('en', { minimumFractionDigits: 2 })} {tx.currency}</td>
                    <td className="font-mono text-red-600 text-sm">{tx.amountDiff ? Number(tx.amountDiff).toLocaleString('en', { minimumFractionDigits: 2 }) : '—'}</td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between text-sm">
          <span className="text-gray-500">إجمالي: {transactions.length} عملية</span>
          {!loading && totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-ghost btn-sm disabled:opacity-30">السابق</button>
              <span className="text-xs text-gray-600">صفحة {page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-ghost btn-sm disabled:opacity-30">التالي</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
