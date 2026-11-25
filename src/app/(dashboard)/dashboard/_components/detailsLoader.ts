import { Tx, MetricAction, CategoryKind } from './types'

export interface DetailResult {
  transactions: Tx[]
  total: number
  hasNext: boolean
}

const DETAIL_LIMIT = 100

async function fetchDetailPage(params: URLSearchParams): Promise<DetailResult> {
  params.set('limit', String(DETAIL_LIMIT))
  params.set('sortBy', 'txDateTime')
  params.set('sortDir', 'desc')

  const response = await fetch(`/api/transactions/query?${params}`, { cache: 'no-store' })
  const payload = await response.json()
  if (!response.ok || !payload.success) return { transactions: [], total: 0, hasNext: false }

  return {
    transactions: (payload.data || []) as Tx[],
    total: Number(payload.pageInfo?.total ?? 0),
    hasNext: Boolean(payload.pageInfo?.hasNext),
  }
}

// Detail dialogs intentionally load one compact cursor page. The full result
// remains available from reconciliation; this avoids turning a click on a
// summary card into a multi-megabyte 10,000-row transfer.
export async function loadCategoryTransactions(
  currency: string,
  category: CategoryKind,
): Promise<DetailResult> {
  return fetchDetailPage(categoryDetailParams(currency, category))
}

export function categoryDetailParams(currency: string, category: CategoryKind): URLSearchParams {
  const params = new URLSearchParams({ currency, category })
  if (category === 'gross') params.set('status', 'MATCHED')
  if (category !== 'internal') params.set('excludeWalletTransfers', '1')
  return params
}

export const METRIC_TITLES: Record<MetricAction, string> = {
  matched: 'مطابقة صحيحة',
  pending_sc: 'شام كاش فقط',
  pending_p: 'المنصة فقط',
  discrepancy: 'فارق في المبلغ',
  waste: 'الهدر',
  internal: 'التحويلات الداخلية',
}

// The metric detail view reads the newest 100 compact records. Internal
// transfer exclusion now happens in the database rather than by transferring
// and scanning raw import JSON in the browser.
export async function loadMetricTransactions(action: MetricAction): Promise<DetailResult> {
  return fetchDetailPage(metricDetailParams(action))
}

export function metricDetailParams(action: MetricAction): URLSearchParams {
  const params = new URLSearchParams()
  switch (action) {
    case 'matched':
      params.set('status', 'MATCHED')
      params.set('excludeWalletTransfers', '1')
      break
    case 'pending_sc':
      params.set('status', 'PENDING_SC')
      params.set('excludeWalletTransfers', '1')
      break
    case 'pending_p':
      params.set('status', 'PENDING_P')
      break
    case 'discrepancy':
      params.set('status', 'DISCREPANCY')
      break
    case 'waste':
      params.set('category', 'waste')
      params.set('excludeWalletTransfers', '1')
      break
    case 'internal':
      params.set('category', 'internal')
      break
  }
  return params
}
