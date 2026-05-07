export type TxStatus = 'MATCHED' | 'PENDING_SC' | 'PENDING_P' | 'DISCREPANCY' | 'WASTE'
export type TxType = 'DEPOSIT' | 'WITHDRAWAL'
export type ReviewCat = 'THEFT' | 'WASTE' | 'EXTRA' | 'EMPLOYEE_ERROR' | 'CUSTOMER_ERROR' | 'PLATFORM_ERROR' | 'COMPLAINT' | 'OTHER'

export const REVIEW_LABELS: Record<ReviewCat, string> = {
  THEFT: 'سرقة',
  WASTE: 'هدر',
  EXTRA: 'زيادة',
  EMPLOYEE_ERROR: 'خطأ موظف',
  CUSTOMER_ERROR: 'خطأ زبون',
  PLATFORM_ERROR: 'خطأ منصة',
  COMPLAINT: 'شكوى',
  OTHER: 'غير ذلك',
}

export const REVIEW_COLORS: Record<ReviewCat, string> = {
  THEFT:          'bg-red-100 text-red-800 ring-red-200',
  WASTE:          'bg-rose-100 text-rose-800 ring-rose-200',
  EXTRA:          'bg-emerald-100 text-emerald-800 ring-emerald-200',
  EMPLOYEE_ERROR: 'bg-amber-100 text-amber-800 ring-amber-200',
  CUSTOMER_ERROR: 'bg-orange-100 text-orange-800 ring-orange-200',
  PLATFORM_ERROR: 'bg-sky-100 text-sky-800 ring-sky-200',
  COMPLAINT:      'bg-violet-100 text-violet-800 ring-violet-200',
  OTHER:          'bg-gray-100 text-gray-800 ring-gray-200',
}

export const STATUS_LABELS: Record<TxStatus, { label: string; cls: string }> = {
  MATCHED:     { label: 'مطابقة',             cls: 'badge-matched' },
  PENDING_SC:  { label: 'شام كاش فقط',        cls: 'badge-pending-sc' },
  PENDING_P:   { label: 'المنصة فقط',         cls: 'badge-pending-p' },
  DISCREPANCY: { label: 'فارق في المبلغ',     cls: 'badge-discrepancy' },
  WASTE:       { label: 'هدر',                cls: 'badge-waste' },
}

export const TYPE_LABELS: Record<TxType, string> = {
  DEPOSIT: 'إيداع', WITHDRAWAL: 'سحب',
}

export interface Transaction {
  id: string
  accountId: string
  account: { name: string }
  source: string
  type: TxType
  status: TxStatus
  shamCashTxId: string | null
  platformTxId: string | null
  platformUserId: string | null
  amount: string
  currency: string
  txDateTime: string
  amountDiff: string | null
  notes: string | null
  rawData: Record<string, unknown> | null
  matchedTx: { rawData: Record<string, unknown> | null } | null
  reviewCategory: ReviewCat | null
  reviewNotes: string | null
  reviewedBy: string | null
  reviewedAt: string | null
}

export interface Filters {
  status: string
  type: string
  accountId: string
  currency: string
  dateFrom: string
  dateTo: string
  reviewed: string          // '' | 'true' | 'false'
  reviewCategory: string    // '' | ReviewCat
}

export interface MatchInfoMap {
  [id: string]: { timeDiffSeconds: number; amountDiff: number; confidence: number } | null
}
