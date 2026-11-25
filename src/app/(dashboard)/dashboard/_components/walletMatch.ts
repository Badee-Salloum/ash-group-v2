// Helper to determine whether a transaction's rawData matches one of the
// wallet identifiers (i.e. it's an internal transfer).
export function matchesWallet(
  raw: Record<string, unknown> | null,
  walletIds: string[],
): boolean {
  if (!raw) return false
  const text = `${raw.accountNumber || ''} ${raw.accountName || ''} ${raw.notes || ''}`.toLowerCase()
  return walletIds.some(wid => {
    const words = wid.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return false
    const textTokens = new Set(text.split(/\s+/).filter(Boolean))
    return words.every(word => {
      const w = word.toLowerCase()
      return w.length >= 2 ? text.includes(w) : textTokens.has(w)
    })
  })
}
