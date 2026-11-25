/** Unknown/empty currencies must never default to USD when establishing a link. */
export function sameCurrency(a: unknown, b: unknown): boolean {
  return typeof a === 'string' && typeof b === 'string'
    && a.trim().length > 0 && a.trim().toUpperCase() === b.trim().toUpperCase()
}

export function currencyMatchKey(id: string, currency: string): string {
  return `${id}\u0000${currency.trim().toUpperCase()}`
}

export type PersistedCurrencyCandidate = {
  id: string
  shamCashTxId: string | null
  currency: string
  amount: unknown
  platformUserId?: string | null
  matchedTxId?: string | null
}

/** Ambiguous candidates are left pending, not silently overwritten in a Map. */
export function uniqueCurrencyCandidates<T extends { shamCashTxId: string | null; currency: string }>(rows: T[]): Map<string, T> {
  const result = new Map<string, T>()
  const ambiguous = new Set<string>()
  for (const row of rows) {
    if (!row.shamCashTxId || !row.currency?.trim()) continue
    const key = currencyMatchKey(row.shamCashTxId, row.currency)
    if (result.has(key)) ambiguous.add(key)
    result.set(key, row)
  }
  for (const key of ambiguous) result.delete(key)
  return result
}

/** Do not pick the first/last row when an import repeats a source identifier. */
export function uniqueAutoCandidates<T>(rows: readonly T[], key: (row: T) => string | null | undefined): Map<string, T> {
  const result = new Map<string, T>(), ambiguous = new Set<string>()
  for (const row of rows) {
    const id = key(row)
    if (!id) continue
    if (result.has(id)) ambiguous.add(id)
    result.set(id, row)
  }
  for (const id of ambiguous) result.delete(id)
  return result
}
