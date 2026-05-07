// Syrian Lira formatter — used for payroll & related amounts.
// SYP is typically displayed as integer with thousand separators.
export function fmtSYP(n: number | null | undefined, opts: { withSymbol?: boolean } = {}): string {
  const { withSymbol = true } = opts
  const value = Number(n || 0)
  const formatted = value.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return withSymbol ? `${formatted} ل.س` : formatted
}
