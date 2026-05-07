// Helper to check if a Sham Cash transaction matches any of our wallet identifiers
// (word-based matching — all words of the identifier must appear in the target text)

export function isInternalTransfer(
  accountNumber: string | undefined | null,
  accountName: string | undefined | null,
  notes: string | undefined | null,
  walletIdentifiers: string[]
): boolean {
  if (!walletIdentifiers || walletIdentifiers.length === 0) return false

  const text = `${accountNumber || ''} ${accountName || ''} ${notes || ''}`.toLowerCase()
  const textTokens = new Set(text.split(/\s+/).filter(Boolean))

  return walletIdentifiers.some(wid => {
    const words = wid.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return false
    // Multi-char words: substring match (tolerant to typos like "عبد لله" vs "عبد الله").
    // Single-char words (e.g. "R K O"): must appear as a standalone token to avoid false positives.
    return words.every(word => {
      const w = word.toLowerCase()
      return w.length >= 2 ? text.includes(w) : textTokens.has(w)
    })
  })
}
