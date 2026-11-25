export const CUSTOMER_DIRECTORY_SORT_KEYS = ['name', 'trustScore', 'totalOps', 'depositSum', 'withdrawalSum', 'balance', 'discrepancyCount', 'lastSeen'] as const
export type DirectorySortKey = typeof CUSTOMER_DIRECTORY_SORT_KEYS[number]
export class DirectorySortError extends Error {}
export function parseDirectorySort(params: URLSearchParams) {
  const key = params.get('sortBy') || 'lastSeen'
  const direction = params.get('sortDir') || 'desc'
  const currency = params.get('currency') || params.get('sortCurrency') || 'USD'
  if (!CUSTOMER_DIRECTORY_SORT_KEYS.includes(key as DirectorySortKey) || !['asc', 'desc'].includes(direction) || !/^[A-Z]{3,12}$/.test(currency)) throw new DirectorySortError('ترتيب غير صالح')
  return { key: key as DirectorySortKey, direction: direction as 'asc' | 'desc', currency }
}
export type DirectorySort = ReturnType<typeof parseDirectorySort>
export function directorySortExpression(sort: DirectorySort, currencyParam: string): string {
  const total = '(cr."depositCount" + cr."withdrawalCount")'
  const deposit = `COALESCE((cr."depositSum"->>${currencyParam})::numeric, 0)`
  const withdrawal = `COALESCE((cr."withdrawalSum"->>${currencyParam})::numeric, 0)`
  const expressions: Record<DirectorySortKey, string> = {
    name: 'cr.name', lastSeen: 'cr."lastSeen"', discrepancyCount: 'cr."discrepancyCount"', totalOps: total,
    trustScore: `CASE WHEN ${total} > 0 THEN GREATEST(0, ROUND((100.0 * cr."matchedCount" - 20.0 * cr."discrepancyCount") / ${total})) ELSE 0 END`,
    depositSum: deposit, withdrawalSum: withdrawal, balance: `(${deposit} - ${withdrawal})`,
  }
  return expressions[sort.key]
}
export function encodeDirectoryCursor(row: { name: string; sortValue?: unknown; lastSeen: Date }, sort: DirectorySort, scope: string) {
  const raw = row.sortValue ?? row.lastSeen
  return Buffer.from(JSON.stringify({ version: 2, name: row.name, value: raw instanceof Date ? raw.toISOString() : String(raw), sort, scope })).toString('base64url')
}
export function decodeDirectoryCursor(token: string | null, sort: DirectorySort, scope: string): { name: string; value: string } | null {
  if (!token) return null
  try {
    if (token.length > 32768) throw new Error()
    const row = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))
    if (row.version === undefined && row.lastSeen && sort.key === 'lastSeen' && sort.direction === 'desc') row.value = row.lastSeen
    else if (row.version !== 2 || row.scope !== scope || JSON.stringify(row.sort) !== JSON.stringify(sort)) throw new Error()
    if (!row.name || typeof row.name !== 'string' || typeof row.value !== 'string') throw new Error()
    if (sort.key === 'lastSeen' && !Number.isFinite(Date.parse(row.value))) throw new Error()
    if (!['name', 'lastSeen'].includes(sort.key) && !/^-?\d+(?:\.\d+)?$/.test(row.value)) throw new Error()
    return { name: row.name, value: row.value }
  } catch { throw new DirectorySortError('مؤشر الصفحة لا يطابق الترتيب والفلاتر') }
}
