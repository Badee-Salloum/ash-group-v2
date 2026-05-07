// Aggressive normalization: remove invisible direction marks, zero-width
// chars, Arabic tatweel, and collapse all whitespace. This survives the
// common issues where accountName has RTL marks injected by Excel exports
// or copy-paste.
const normalize = (s: string) =>
  String(s || '')
    .replace(/[​-‏‪-‮⁦-⁩﻿ـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

export function makeMatchesWallet(allWalletIds: string[]) {
  return (raw: Record<string, unknown> | null) => {
    if (!raw) return false
    const accNum = normalize(String(raw.accountNumber || ''))
    const accName = normalize(String(raw.accountName || ''))
    const notes = normalize(String(raw.notes || ''))
    const text = `${accNum} ${accName} ${notes}`
    return allWalletIds.some(wid => {
      const widN = normalize(wid)
      if (!widN) return false
      // Direct full-string hit first (handles names with punctuation/tatweel)
      if (text.includes(widN)) return true
      if (accName === widN || accNum === widN) return true
      // Word-based fallback
      const words = widN.split(/\s+/).filter(Boolean)
      if (words.length === 0) return false
      const textTokens = new Set(text.split(/\s+/).filter(Boolean))
      return words.every(word => {
        return word.length >= 2 ? text.includes(word) : textTokens.has(word)
      })
    })
  }
}
