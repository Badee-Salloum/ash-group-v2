import { TransactionStatus, TransactionType, TransactionSource, UserRole } from '@/lib/db/prisma-types'

// ─── File Parsing ────────────────────────────────────────────────────────────

export interface ShamCashRow {
  txId: string           // رقم العملية
  type: 'DEPOSIT' | 'WITHDRAWAL' // استقبال | إرسال
  receivedAmount: number // المبلغ المستلم
  sentAmount: number     // المبلغ المدفوع
  currency: string
  date: string           // YYYY-MM-DD
  time: string           // HH:MM:SS
  txDateTime: Date
  accountNumber: string  // رقم حساب
  accountName: string    // اسم حساب
  notes: string
}

export interface PlatformDepositRow {
  txId: string           // Transaction ID
  userId: string         // User ID
  amount: number
  currency: string
  status: string
  bankName: string
  provider: string
  createdAt: Date
  depositTime: Date      // Time of deposit - used for time matching
  userInfo: string       // raw User info field
  shamCashTxId: string | null // extracted from userInfo
  admin: string
}

export interface PlatformWithdrawalRow {
  txId: string           // Transaction ID
  userId: string         // User ID
  amount: number
  currency: string
  status: string
  withdrawalTime: Date   // Time of withdrawal
  payoutTime: Date       // Time of payout - used for time matching
  userInfo: string       // رابط المحفظة
  bankName: string
  provider: string
  payoutConfirmation: string
  shamCashTxId?: string | null  // Extracted from User info (e.g. "BankTranferComment: 192901444")
}

// ─── Reconciliation Results ──────────────────────────────────────────────────

export interface ReconciliationResult {
  matched: MatchedPair[]
  shamCashOnly: ShamCashRow[]          // PENDING_SC - في شام كاش فقط
  platformOnly: PlatformDepositRow[]   // PENDING_P  - في المنصة فقط
  resolvedFromComplaint: MatchedPair[] // حُلَّت عبر User ID من دورة سابقة
  discrepancySCHigher: DiscrepancyItem[]  // شام كاش أكبر
  discrepancyPHigher: DiscrepancyItem[]   // المنصة أكبر
  internalTransfers: ShamCashRow[]        // SC deposits whose sender matches own walletIds
}

export interface WithdrawalReconciliationResult {
  matched: WithdrawalMatchedPair[]
  shamCashOnly: ShamCashRow[]
  platformOnly: PlatformWithdrawalRow[]
  discrepancySCHigher: WithdrawalDiscrepancy[]
  discrepancyPHigher: WithdrawalDiscrepancy[]  // requires manual SC tx id input
  internalTransfers: ShamCashRow[]              // SC sends to own wallets — not real customer withdrawals
}

export interface MatchedPair {
  shamCash: ShamCashRow
  platform: PlatformDepositRow
}

export interface WithdrawalMatchedPair {
  shamCash: ShamCashRow
  platform: PlatformWithdrawalRow
  timeDiffSeconds: number
}

export interface DiscrepancyItem {
  shamCash: ShamCashRow
  platform: PlatformDepositRow
  diff: number
}

export interface WithdrawalDiscrepancy {
  shamCash: ShamCashRow
  platform: PlatformWithdrawalRow
  diff: number
  timeDiffSeconds: number
}

// ─── Profits ─────────────────────────────────────────────────────────────────

export interface AccountProfitSummary {
  accountId: string
  accountName: string
  currency: string
  deposits: {
    matched: number
    matchedAmount: number
    profitRate: number
    grossProfit: number
    waste: number        // PENDING_P deposits + discrepancy P higher
    netProfit: number
  }
  withdrawals: {
    matched: number
    matchedAmount: number
    profitRate: number
    grossProfit: number
    waste: number        // SC only + SC higher discrepancy
    netProfit: number
  }
  totalGrossProfit: number
  totalWaste: number
  totalNetProfit: number
}

// ─── API Response ────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

// ─── Table Filter ────────────────────────────────────────────────────────────

export interface TableFilter {
  page?: number
  pageSize?: number
  search?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  status?: TransactionStatus
  type?: TransactionType
  source?: TransactionSource
  accountId?: string
  dateFrom?: string
  dateTo?: string
}
