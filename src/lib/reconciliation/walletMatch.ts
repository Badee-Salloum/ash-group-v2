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

// When an SC row carries an internal-transfer signature (its account name
// matches a wallet identifier) AND its TX-ID-linked platform partner has a
// wildly divergent amount, the link is almost certainly spurious — the SC was
// an internal wallet move, and the platform op is an unrelated customer op
// that just happens to share a TX-ID stub.
//
// Returns true when the reconciliation engine should NOT pair the two and
// instead route the SC row to `internalTransfers`, leaving the platform row
// unmatched. Returning false preserves the prior "TX-ID match wins" behavior
// for the regression case where a real customer's name simply overlaps with
// a wallet identifier.
//
// The divergence threshold defaults to 10× (smaller is <10% of larger). This
// catches the user-reported 440-vs-15 case (ratio 0.034) without affecting
// genuine small-error discrepancies like 100-vs-95 (ratio 0.95).
export function isSpuriousInternalPair(opts: {
  scAccountNumber: string | null | undefined
  scAccountName: string | null | undefined
  scNotes: string | null | undefined
  walletIdentifiers: string[]
  scAmount: number
  pAmount: number
  ratioFloor?: number
}): boolean {
  const ratioFloor = opts.ratioFloor ?? 0.1
  if (!isInternalTransfer(
    opts.scAccountNumber, opts.scAccountName, opts.scNotes, opts.walletIdentifiers,
  )) {
    return false
  }
  const max = Math.max(opts.scAmount, opts.pAmount)
  if (max === 0) return false
  const min = Math.min(opts.scAmount, opts.pAmount)
  return (min / max) < ratioFloor
}
