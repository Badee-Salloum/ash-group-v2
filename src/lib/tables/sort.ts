export type SortDirection = 'asc' | 'desc'
const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' })

function normalize(value: unknown): string | number | null {
  if (value == null || value === '' || value === '—' || value === '–') return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'object') {
    if ('name' in value) return String((value as { name: unknown }).name)
    // Never add amounts denominated in different currencies.
    return Object.entries(value).sort(([a], [b]) => collator.compare(a, b))
      .map(([key, amount]) => `${key}:${amount}`).join(' | ')
  }
  const text = String(value).trim().replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776)).replace(/−/g, '-').replace(/٪/g, '%')
  const numeric = text.replace(/[,٬\s]/g, '').replace(/٫/g, '.').replace(/%$/, '')
  if (/^[+-]?\d+(?:\.\d+)?$/.test(numeric)) return Number(numeric)
  if (/^\d{4}-\d{2}-\d{2}(?:T|\s|$)/.test(text)) {
    const date = Date.parse(text)
    if (Number.isFinite(date)) return date
  }
  // Currency is the primary key, amount the secondary key. No implicit FX.
  const moneyText = text.replace(/ل\.س\.?/g, 'SYP').replace(/^([+-]?)\$([\d,.]+)$/, 'USD $1$2')
  const money = moneyText.match(/^(?:([A-Z]{3})\s+([+-]?[\d,.]+)|([+-]?[\d,.]+)\s+([A-Z]{3}))$/)
  if (money) return `${money[1] || money[4]}:${money[2] || money[3]}`
  return text
}

export function compareTableValues(a: unknown, b: unknown, direction: SortDirection = 'asc'): number {
  if (a && b && typeof a === 'object' && typeof b === 'object' && !(a instanceof Date) && !(b instanceof Date) && !('name' in a) && !('name' in b)) {
    const ak = Object.keys(a).sort(), bk = Object.keys(b).sort()
    const keys = collator.compare(ak.join('|'), bk.join('|'))
    if (keys) return keys * (direction === 'asc' ? 1 : -1)
    for (const key of ak) {
      const result = compareTableValues((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], direction)
      if (result) return result
    }
    return 0
  }
  const left = normalize(a), right = normalize(b)
  // Missing values remain at the bottom in both directions.
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1
  const moneyLeft = typeof left === 'string' && left.match(/^([A-Z]{3}):([+-]?[\d,.]+)$/)
  const moneyRight = typeof right === 'string' && right.match(/^([A-Z]{3}):([+-]?[\d,.]+)$/)
  let result: number
  if (moneyLeft && moneyRight) {
    result = collator.compare(moneyLeft[1], moneyRight[1]) || Number(moneyLeft[2].replace(/,/g, '')) - Number(moneyRight[2].replace(/,/g, ''))
  } else result = typeof left === 'number' && typeof right === 'number'
    ? left - right : collator.compare(String(left), String(right))
  return (direction === 'asc' ? 1 : -1) * result
}
