// NOTE: ACCOUNTANT role was removed. The enum value still exists in
// schema.prisma so existing rows in the shared DB don't break, but it is
// intentionally absent from this type union — code may not reference it.
export type UserRole = 'ADMIN' | 'SUPERVISOR' | 'ACCOUNT_MGR' | 'MANAGER' | 'EMPLOYEE'
export type TransactionStatus = 'MATCHED' | 'PENDING_SC' | 'PENDING_P' | 'DISCREPANCY' | 'WASTE'
export type TransactionType = 'DEPOSIT' | 'WITHDRAWAL'
export type TransactionSource = 'SHAM_CASH' | 'PLATFORM'
export type BatchStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED'
export type ReviewCategory = 'THEFT' | 'WASTE' | 'EXTRA' | 'EMPLOYEE_ERROR' | 'CUSTOMER_ERROR' | 'PLATFORM_ERROR' | 'COMPLAINT' | 'OTHER'
export type FollowUpStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'

export const UserRole = {
  ADMIN: 'ADMIN' as const,
  SUPERVISOR: 'SUPERVISOR' as const,
  ACCOUNT_MGR: 'ACCOUNT_MGR' as const,
  MANAGER: 'MANAGER' as const,
  EMPLOYEE: 'EMPLOYEE' as const,
}
export const TransactionStatus = { MATCHED: 'MATCHED' as const, PENDING_SC: 'PENDING_SC' as const, PENDING_P: 'PENDING_P' as const, DISCREPANCY: 'DISCREPANCY' as const, WASTE: 'WASTE' as const }
export const TransactionType = { DEPOSIT: 'DEPOSIT' as const, WITHDRAWAL: 'WITHDRAWAL' as const }
export const TransactionSource = { SHAM_CASH: 'SHAM_CASH' as const, PLATFORM: 'PLATFORM' as const }
export const ReviewCategory = {
  THEFT: 'THEFT' as const,
  WASTE: 'WASTE' as const,
  EXTRA: 'EXTRA' as const,
  EMPLOYEE_ERROR: 'EMPLOYEE_ERROR' as const,
  CUSTOMER_ERROR: 'CUSTOMER_ERROR' as const,
  PLATFORM_ERROR: 'PLATFORM_ERROR' as const,
  COMPLAINT: 'COMPLAINT' as const,
  OTHER: 'OTHER' as const,
}
export const FollowUpStatus = {
  OPEN: 'OPEN' as const,
  IN_PROGRESS: 'IN_PROGRESS' as const,
  RESOLVED: 'RESOLVED' as const,
  CLOSED: 'CLOSED' as const,
}
