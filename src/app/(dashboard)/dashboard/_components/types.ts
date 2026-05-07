export interface Tx {
  id: string; type: string; status: string; source: string
  shamCashTxId: string | null; platformTxId: string | null; platformUserId: string | null
  amount: string; currency: string; txDateTime: string; amountDiff: string | null
  rawData: Record<string, unknown> | null
}

export interface AccountSummary {
  accountId: string; accountName: string; currency: string
  matchedCount: number; pendingCount: number; grossProfit?: number; wasteAmount?: number; extrasAmount?: number; netProfit?: number
  internalCount?: number; internalAmount?: number
}

export interface Stats {
  totalMatched: number; totalMatchedAmount?: number; totalPendingSC: number; totalPendingP: number
  totalDiscrepancy: number; totalWaste: number; totalWasteAmount?: number
  totalExtras?: number; totalExtrasAmount?: number
  totalInternal?: number
  recentBatches: Array<{ id: string; accountName: string; batchDate: string; status: string; rowsProcessed: number }>
  accountSummaries: AccountSummary[]; totalExpenses?: number; isRestricted?: boolean
}

export type MetricAction = 'matched' | 'pending_sc' | 'pending_p' | 'discrepancy' | 'waste' | 'internal'
export type CategoryKind = 'internal' | 'gross' | 'waste' | 'extras'

export const STATUS_LABELS_DASH: Record<string, string> = {
  MATCHED: 'مطابقة', PENDING_SC: 'شام كاش فقط', PENDING_P: 'المنصة فقط', DISCREPANCY: 'فارق في المبلغ', WASTE: 'هدر',
}
export const STATUS_COLORS_DASH: Record<string, string> = {
  MATCHED: 'text-green-700 bg-green-50', PENDING_SC: 'text-amber-700 bg-amber-50',
  PENDING_P: 'text-blue-700 bg-blue-50', DISCREPANCY: 'text-red-700 bg-red-50', WASTE: 'text-gray-700 bg-gray-100',
}
