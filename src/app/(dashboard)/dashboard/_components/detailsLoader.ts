import { Tx, MetricAction, CategoryKind } from './types'
import { matchesWallet } from './walletMatch'

async function fetchWalletIds(): Promise<string[]> {
  const accRes = await fetch('/api/accounts')
  const accData = await accRes.json()
  return accData.success
    ? accData.data.flatMap((a: { walletIdentifiers?: string[] }) => a.walletIdentifiers || [])
    : []
}

async function fetchFiltered(params: URLSearchParams): Promise<Tx[]> {
  const r = await fetch(`/api/transactions?${params}`)
  const j = await r.json()
  return j.success ? (j.data as Tx[]) : []
}

// Load transactions for one of the per-currency category cards.
export async function loadCategoryTransactions(
  currency: string,
  category: CategoryKind,
): Promise<Tx[]> {
  const baseParams = new URLSearchParams({ currency, pageSize: '10000' })
  const allWalletIds = await fetchWalletIds()

  let allTxs: Tx[] = []
  if (category === 'internal') {
    const p = new URLSearchParams(baseParams); p.set('status', 'PENDING_SC'); p.set('source', 'SHAM_CASH')
    const rows = await fetchFiltered(p)
    allTxs = rows.filter(t => matchesWallet(t.rawData as Record<string, unknown> | null, allWalletIds))
  } else if (category === 'gross') {
    const p = new URLSearchParams(baseParams); p.set('status', 'MATCHED')
    allTxs = await fetchFiltered(p)
  } else if (category === 'waste') {
    const p1 = new URLSearchParams(baseParams); p1.set('type', 'DEPOSIT'); p1.set('status', 'PENDING_P'); p1.set('source', 'PLATFORM')
    const p2 = new URLSearchParams(baseParams); p2.set('type', 'DEPOSIT'); p2.set('status', 'DISCREPANCY'); p2.set('source', 'PLATFORM')
    const p3 = new URLSearchParams(baseParams); p3.set('type', 'WITHDRAWAL'); p3.set('status', 'DISCREPANCY'); p3.set('source', 'SHAM_CASH')
    const p4 = new URLSearchParams(baseParams); p4.set('type', 'WITHDRAWAL'); p4.set('status', 'PENDING_SC')
    const [r1, r2, r3, r4] = await Promise.all([fetchFiltered(p1), fetchFiltered(p2), fetchFiltered(p3), fetchFiltered(p4)])
    const r4Filtered = allWalletIds.length > 0 ? r4.filter(t => !matchesWallet(t.rawData as Record<string, unknown> | null, allWalletIds)) : r4
    allTxs = [...r1, ...r2, ...r3, ...r4Filtered]
  } else if (category === 'extras') {
    const p1 = new URLSearchParams(baseParams); p1.set('type', 'DEPOSIT'); p1.set('status', 'PENDING_SC')
    const p2 = new URLSearchParams(baseParams); p2.set('type', 'DEPOSIT'); p2.set('status', 'DISCREPANCY'); p2.set('source', 'SHAM_CASH')
    const p3 = new URLSearchParams(baseParams); p3.set('type', 'WITHDRAWAL'); p3.set('status', 'PENDING_P')
    const p4 = new URLSearchParams(baseParams); p4.set('type', 'WITHDRAWAL'); p4.set('status', 'DISCREPANCY'); p4.set('source', 'PLATFORM')
    const [r1, r2, r3, r4] = await Promise.all([fetchFiltered(p1), fetchFiltered(p2), fetchFiltered(p3), fetchFiltered(p4)])
    const r1Filtered = allWalletIds.length > 0 ? r1.filter(t => !matchesWallet(t.rawData as Record<string, unknown> | null, allWalletIds)) : r1
    allTxs = [...r1Filtered, ...r2, ...r3, ...r4]
  }
  allTxs.sort((a, b) => new Date(b.txDateTime).getTime() - new Date(a.txDateTime).getTime())
  return allTxs
}

export const METRIC_TITLES: Record<MetricAction, string> = {
  matched: 'مطابقة صحيحة', pending_sc: 'شام كاش فقط', pending_p: 'المنصة فقط',
  discrepancy: 'فارق في المبلغ', waste: 'الهدر', internal: 'التحويلات الداخلية',
}

// Load transactions for the top metric cards.
export async function loadMetricTransactions(action: MetricAction): Promise<Tx[]> {
  const allWalletIds = await fetchWalletIds()

  let txs: Tx[] = []
  if (action === 'matched') {
    const p = new URLSearchParams({ status: 'MATCHED', pageSize: '10000' })
    txs = await fetchFiltered(p)
  } else if (action === 'pending_sc') {
    const p = new URLSearchParams({ status: 'PENDING_SC', pageSize: '10000' })
    const all = await fetchFiltered(p)
    // Exclude internal
    txs = allWalletIds.length > 0 ? all.filter(t => !matchesWallet(t.rawData as Record<string, unknown> | null, allWalletIds)) : all
  } else if (action === 'pending_p') {
    const p = new URLSearchParams({ status: 'PENDING_P', pageSize: '10000' })
    txs = await fetchFiltered(p)
  } else if (action === 'discrepancy') {
    const p = new URLSearchParams({ status: 'DISCREPANCY', pageSize: '10000' })
    txs = await fetchFiltered(p)
  } else if (action === 'waste') {
    const p1 = new URLSearchParams({ type: 'DEPOSIT', status: 'PENDING_P', source: 'PLATFORM', pageSize: '10000' })
    const p2 = new URLSearchParams({ type: 'DEPOSIT', status: 'DISCREPANCY', source: 'PLATFORM', pageSize: '10000' })
    const p3 = new URLSearchParams({ type: 'WITHDRAWAL', status: 'DISCREPANCY', source: 'SHAM_CASH', pageSize: '10000' })
    const p4 = new URLSearchParams({ type: 'WITHDRAWAL', status: 'PENDING_SC', pageSize: '10000' })
    const [r1, r2, r3, r4] = await Promise.all([fetchFiltered(p1), fetchFiltered(p2), fetchFiltered(p3), fetchFiltered(p4)])
    const r4Filtered = allWalletIds.length > 0 ? r4.filter(t => !matchesWallet(t.rawData as Record<string, unknown> | null, allWalletIds)) : r4
    txs = [...r1, ...r2, ...r3, ...r4Filtered]
  } else if (action === 'internal') {
    const p = new URLSearchParams({ status: 'PENDING_SC', source: 'SHAM_CASH', pageSize: '10000' })
    const all = await fetchFiltered(p)
    txs = all.filter(t => matchesWallet(t.rawData as Record<string, unknown> | null, allWalletIds))
  }

  txs.sort((a, b) => new Date(b.txDateTime).getTime() - new Date(a.txDateTime).getTime())
  return txs
}
