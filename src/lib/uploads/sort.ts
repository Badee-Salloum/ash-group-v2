import type { Prisma } from '@prisma/client'

export const UPLOAD_SORT_KEYS = ['createdAt', 'accountName', 'uploaderName', 'status', 'rowsProcessed', 'processedAt', 'errorLog'] as const
export type UploadSort = { key: typeof UPLOAD_SORT_KEYS[number]; direction: 'asc' | 'desc' }
export class UploadSortError extends Error {}

export function parseUploadSort(params: URLSearchParams): UploadSort {
  const key = params.get('sortBy') || 'createdAt'
  const direction = params.get('sortDir') || 'desc'
  if (!UPLOAD_SORT_KEYS.includes(key as UploadSort['key']) || !['asc', 'desc'].includes(direction)) {
    throw new UploadSortError('ترتيب غير صالح')
  }
  return { key: key as UploadSort['key'], direction: direction as UploadSort['direction'] }
}

export function uploadOrderBy(sort: UploadSort): Prisma.UploadBatchOrderByWithRelationInput[] {
  const primary = sort.key === 'accountName' ? { account: { name: sort.direction } }
    : sort.key === 'uploaderName' ? { uploader: { name: sort.direction } }
      : { [sort.key]: ['processedAt', 'errorLog'].includes(sort.key) ? { sort: sort.direction, nulls: 'last' } : sort.direction }
  return [primary, { id: sort.direction }] as Prisma.UploadBatchOrderByWithRelationInput[]
}
