export type FollowUpStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
export type FollowUpCategory = 'COMPLAINT' | 'CUSTOMER_ERROR' | 'PLATFORM_ERROR'
export type TxType = 'DEPOSIT' | 'WITHDRAWAL'
export type TxSource = 'SHAM_CASH' | 'PLATFORM'
export type TxStatus = 'MATCHED' | 'PENDING_SC' | 'PENDING_P' | 'DISCREPANCY' | 'WASTE' | 'RETURNS'
export type ReviewCategory =
  | 'THEFT' | 'WASTE' | 'EXTRA' | 'EMPLOYEE_ERROR' | 'CUSTOMER_ERROR'
  | 'PLATFORM_ERROR' | 'COMPLAINT' | 'INTERNAL_TRANSFER' | 'OTHER'

export interface FollowUpRow {
  id: string
  accountId: string
  accountName: string
  currency: string
  type: TxType
  source: TxSource
  amount: string
  txDateTime: string
  shamCashTxId: string | null
  platformTxId: string | null
  platformUserId: string | null
  status: TxStatus
  reviewCategory: FollowUpCategory | null
  reviewNotes: string | null
  reviewedAt: string | null
  reviewedByName: string | null
  followUpStatus: FollowUpStatus | null
  followUpAssignedTo: string | null
  followUpAssigneeName: string | null
  followUpResolution: string | null
  followUpResolvedAt: string | null
  followUpResolvedByName: string | null
}

export interface AssigneeUser {
  id: string
  name: string
  role: string
}

export interface FollowUpFilters {
  status: '' | FollowUpStatus
  category: '' | FollowUpCategory
  assignedTo: '' | 'me' | 'unassigned' | string
  search: string
  dateFrom: string
  dateTo: string
  includeClosed: boolean
}

export const STATUS_LABELS: Record<FollowUpStatus, { label: string; cls: string }> = {
  OPEN:        { label: 'مفتوحة',        cls: 'bg-amber-100 text-amber-800 ring-amber-200' },
  IN_PROGRESS: { label: 'قيد المعالجة',  cls: 'bg-sky-100 text-sky-800 ring-sky-200' },
  RESOLVED:    { label: 'تم الحل',        cls: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  CLOSED:      { label: 'مغلقة بلا حل',  cls: 'bg-gray-100 text-gray-700 ring-gray-200' },
}

export const CATEGORY_LABELS: Record<FollowUpCategory, string> = {
  COMPLAINT:      'شكوى',
  CUSTOMER_ERROR: 'خطأ زبون',
  PLATFORM_ERROR: 'خطأ منصة',
}

export const TYPE_LABELS: Record<TxType, string> = {
  DEPOSIT:    'إيداع',
  WITHDRAWAL: 'سحب',
}

export const SOURCE_LABELS: Record<TxSource, string> = {
  SHAM_CASH: 'شام كاش',
  PLATFORM:  'المنصة',
}

// The underlying transaction's own status — editable from the follow-up modal.
export const TX_STATUS_LABELS: Record<TxStatus, { label: string; cls: string }> = {
  MATCHED:     { label: 'مطابقة',          cls: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  PENDING_SC:  { label: 'شام كاش فقط',     cls: 'bg-amber-100 text-amber-800 ring-amber-200' },
  PENDING_P:   { label: 'المنصة فقط',      cls: 'bg-sky-100 text-sky-800 ring-sky-200' },
  DISCREPANCY: { label: 'فارق في المبلغ',  cls: 'bg-rose-100 text-rose-800 ring-rose-200' },
  WASTE:       { label: 'هدر',             cls: 'bg-gray-200 text-gray-800 ring-gray-300' },
  RETURNS:     { label: 'مرتجعات',         cls: 'bg-indigo-100 text-indigo-800 ring-indigo-200' },
}

// Full review-category set (manual classification).
export const REVIEW_CATEGORY_LABELS: Record<ReviewCategory, string> = {
  THEFT:             'سرقة',
  WASTE:             'هدر',
  EXTRA:             'زيادة',
  EMPLOYEE_ERROR:    'خطأ موظف',
  CUSTOMER_ERROR:    'خطأ زبون',
  PLATFORM_ERROR:    'خطأ منصة',
  COMPLAINT:         'شكوى',
  INTERNAL_TRANSFER: 'تحويل داخلي',
  OTHER:             'غير ذلك',
}
