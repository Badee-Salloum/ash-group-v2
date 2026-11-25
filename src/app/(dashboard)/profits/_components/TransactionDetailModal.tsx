'use client'
import { TransactionQueryTable } from '@/components/tables/TransactionQueryTable'

export function TransactionDetailModal({ title, query, onClose }: { title: string; query: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-2 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl" aria-label="إغلاق">&times;</button>
        </div>
        <div className="overflow-auto flex-1 p-4"><TransactionQueryTable key={query} query={query} /></div>
      </div>
    </div>
  )
}
