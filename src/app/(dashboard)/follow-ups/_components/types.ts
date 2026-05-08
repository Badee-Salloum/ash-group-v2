export type FollowUpStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
export type FollowUpCategory = 'COMPLAINT' | 'CUSTOMER_ERROR' | 'PLATFORM_ERROR'
export type TxType = 'DEPOSIT' | 'WITHDRAWAL'
export type TxSource = 'SHAM_CASH' | 'PLATFORM'

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
