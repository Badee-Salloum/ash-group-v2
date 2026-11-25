/** Shared by incremental refreshes and the resumable read-model rebuild. */
export const duplicatePairCountSql = `count(DISTINCT least(t.id, coalesce(t."matchedTxId", t.id)))
  FILTER (WHERE t.status IN ('MATCHED', 'DISCREPANCY'))`

export const currencyMismatchSql = `coalesce(bool_or(
  m.id IS NOT NULL AND upper(btrim(t.currency)) <> upper(btrim(m.currency))
), FALSE)`

export function hasLinkedCurrencyMismatch(
  row: { currency: string; matchedTx: { currency: string } | null },
): boolean {
  return Boolean(row.matchedTx
    && row.currency.trim().toUpperCase() !== row.matchedTx.currency.trim().toUpperCase())
}
