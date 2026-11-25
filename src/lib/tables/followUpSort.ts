import type { Prisma } from '@prisma/client'
export const FOLLOW_UP_SORT_KEYS = ['followUpStatus', 'reviewCategory', 'accountName', 'amount', 'platformUserId', 'followUpAssigneeName', 'reviewedAt', 'batch'] as const
export function followUpOrderBy(params: URLSearchParams): Prisma.TransactionOrderByWithRelationInput[] {
  const key = params.get('sortBy'), direction = params.get('sortDir') || 'asc'
  if (!key) return [{ followUpStatus: 'asc' }, { reviewedAt: 'asc' }, { id: 'asc' }]
  if (!FOLLOW_UP_SORT_KEYS.includes(key as typeof FOLLOW_UP_SORT_KEYS[number]) || !['asc', 'desc'].includes(direction)) throw new Error('INVALID_SORT')
  const relation: Record<string, string> = { accountName: 'account', followUpAssigneeName: 'followUpAssignee', batch: 'batch' }
  const primary = relation[key] ? { [relation[key]]: { [key === 'batch' ? 'createdAt' : 'name']: direction } }
    : { [key]: ['reviewedAt', 'platformUserId', 'reviewCategory', 'followUpStatus'].includes(key) ? { sort: direction, nulls: 'last' } : direction }
  return [primary, { id: direction }] as Prisma.TransactionOrderByWithRelationInput[]
}
