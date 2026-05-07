export interface WasteBreakdown {
  platformOnly?: number
  discrepancyPHigher?: number
  discrepancySCHigher?: number
  scOnly?: number
}

export interface ExtrasBreakdown {
  scOnly?: number
  discrepancySCHigher?: number
  platformOnly?: number
  discrepancyPHigher?: number
}

export interface InternalTransfers {
  deposits: { count: number; amount: number }
  withdrawals: { count: number; amount: number }
  totalCount: number
  totalAmount: number
}

export interface AccountProfit {
  accountId: string
  accountName: string
  currency: string
  deposits: { matched: number; matchedAmount: number; profitRate: number; grossProfit: number; waste: number; wasteBreakdown?: WasteBreakdown; extras: number; extrasBreakdown?: ExtrasBreakdown; netProfit: number }
  withdrawals: { matched: number; matchedAmount: number; profitRate: number; grossProfit: number; waste: number; wasteBreakdown?: WasteBreakdown; extras: number; extrasBreakdown?: ExtrasBreakdown; netProfit: number }
  totalGrossProfit: number
  totalWaste: number
  totalExtras: number
  totalNetProfit: number
  internalTransfers?: InternalTransfers
}

export interface ProfitData {
  accounts: AccountProfit[]
  totalExpenses: number
  totalNetProfit: number
  totalExtras: number
  finalProfit: number
}

export interface Transaction {
  id: string
  type: string
  status: string
  source: string
  shamCashTxId: string | null
  platformTxId: string | null
  platformUserId: string | null
  amount: string
  currency: string
  txDateTime: string
  amountDiff: string | null
  account: { name: string }
  rawData: { accountName?: string; accountNumber?: string; to?: string } | null
}

export type CategoryKind = 'internal' | 'gross' | 'waste' | 'extras'

export const STATUS_LABELS: Record<string, string> = {
  MATCHED: 'مطابقة',
  PENDING_SC: 'شام كاش فقط',
  PENDING_P: 'المنصة فقط',
  DISCREPANCY: 'فارق في المبلغ',
  WASTE: 'هدر',
}

export const STATUS_COLORS: Record<string, string> = {
  MATCHED: 'text-green-700 bg-green-50',
  PENDING_SC: 'text-amber-700 bg-amber-50',
  PENDING_P: 'text-blue-700 bg-blue-50',
  DISCREPANCY: 'text-red-700 bg-red-50',
  WASTE: 'text-gray-700 bg-gray-100',
}

export function fmt(n: number, currency = 'USD') {
  return n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + currency
}
