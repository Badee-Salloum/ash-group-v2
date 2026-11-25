import { db } from '@/lib/db/client'
import { damascusDateStr } from '@/lib/datetime'

export type FinancialAggregate = {
  accountId: string
  currency: string
  matchedDepositCount: number | bigint
  matchedDepositAmount: unknown
  matchedWithdrawalCount: number | bigint
  matchedWithdrawalAmount: unknown
  pendingScCount: number | bigint
  pendingScAmount: unknown
  pendingPCount: number | bigint
  pendingPAmount: unknown
  discrepancyCount: number | bigint
  discrepancyAmount: unknown
  depositWasteAmount: unknown
  withdrawalWasteAmount: unknown
  depositExtrasAmount: unknown
  withdrawalExtrasAmount: unknown
  depositPlatformOnlyAmount: unknown
  depositDiscrepancyPHigherAmount: unknown
  withdrawalScOnlyAmount: unknown
  withdrawalDiscrepancySCHigherAmount: unknown
  depositScOnlyAmount: unknown
  depositDiscrepancySCHigherAmount: unknown
  withdrawalPlatformOnlyAmount: unknown
  withdrawalDiscrepancyPHigherAmount: unknown
  internalDepositCount: number | bigint
  internalDepositAmount: unknown
  internalWithdrawalCount: number | bigint
  internalWithdrawalAmount: unknown
}

export type FinancialAggregateOptions = {
  accountIds?: string[]
  dateFrom?: Date | null
  dateToExclusive?: Date | null
}

/**
 * One grouped SQL query replaces the former account × currency × metric fanout.
 * It intentionally selects no rawData and is valid during the read-model
 * backfill; a later release can transparently source the same shape from
 * financial_daily_summaries.
 */
async function getDirectFinancialAggregates(
  options: FinancialAggregateOptions = {},
): Promise<FinancialAggregate[]> {
  const values: unknown[] = []
  const bind = (value: unknown) => {
    values.push(value)
    return `$${values.length}`
  }
  const predicates = [`(t."reviewCategory" IS NULL OR t."reviewCategory" <> 'COMPLAINT')`]
  if (options.accountIds) {
    if (options.accountIds.length === 0) return []
    predicates.push(`t."accountId" = ANY(${bind(options.accountIds)}::text[])`)
  }
  if (options.dateFrom) predicates.push(`t."txDateTime" >= ${bind(options.dateFrom)}`)
  if (options.dateToExclusive) predicates.push(`t."txDateTime" < ${bind(options.dateToExclusive)}`)

  const sql = `
    SELECT
      t."accountId" AS "accountId", t.currency,
      count(*) FILTER (WHERE t.status = 'MATCHED' AND t.source = 'SHAM_CASH' AND t.type = 'DEPOSIT'
        AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER'))::int AS "matchedDepositCount",
      COALESCE(sum(t.amount) FILTER (WHERE t.status = 'MATCHED' AND t.source = 'SHAM_CASH' AND t.type = 'DEPOSIT'
        AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0) AS "matchedDepositAmount",
      count(*) FILTER (WHERE t.status = 'MATCHED' AND t.source = 'SHAM_CASH' AND t.type = 'WITHDRAWAL'
        AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER'))::int AS "matchedWithdrawalCount",
      COALESCE(sum(t.amount) FILTER (WHERE t.status = 'MATCHED' AND t.source = 'SHAM_CASH' AND t.type = 'WITHDRAWAL'
        AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0) AS "matchedWithdrawalAmount",
      count(*) FILTER (WHERE t.status = 'PENDING_SC' AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER'))::int AS "pendingScCount",
      COALESCE(sum(t.amount) FILTER (WHERE t.status = 'PENDING_SC' AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0) AS "pendingScAmount",
      count(*) FILTER (WHERE t.status = 'PENDING_P')::int AS "pendingPCount",
      COALESCE(sum(t.amount) FILTER (WHERE t.status = 'PENDING_P'), 0) AS "pendingPAmount",
      count(*) FILTER (WHERE t.status = 'DISCREPANCY' AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER'))::int AS "discrepancyCount",
      COALESCE(sum(COALESCE(t."amountDiff", t.amount)) FILTER (WHERE t.status = 'DISCREPANCY'
        AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0) AS "discrepancyAmount",
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'PENDING_P' AND t.source = 'PLATFORM'), 0)
        + COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'DISCREPANCY' AND t.source = 'PLATFORM'), 0) AS "depositWasteAmount",
      COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'DISCREPANCY' AND t.source = 'SHAM_CASH'), 0)
        + COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'PENDING_SC'
          AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0) AS "withdrawalWasteAmount",
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'PENDING_SC'
          AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0)
        + COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'DISCREPANCY' AND t.source = 'SHAM_CASH'), 0) AS "depositExtrasAmount",
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'PENDING_P'), 0)
        + COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'DISCREPANCY' AND t.source = 'PLATFORM'), 0) AS "withdrawalExtrasAmount",
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'PENDING_P' AND t.source = 'PLATFORM'), 0) AS "depositPlatformOnlyAmount",
      COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'DISCREPANCY' AND t.source = 'PLATFORM'), 0) AS "depositDiscrepancyPHigherAmount",
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'PENDING_SC'
          AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0) AS "withdrawalScOnlyAmount",
      COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'DISCREPANCY' AND t.source = 'SHAM_CASH'), 0) AS "withdrawalDiscrepancySCHigherAmount",
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'PENDING_SC'
          AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0) AS "depositScOnlyAmount",
      COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'DISCREPANCY' AND t.source = 'SHAM_CASH'), 0) AS "depositDiscrepancySCHigherAmount",
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'PENDING_P'), 0) AS "withdrawalPlatformOnlyAmount",
      COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'DISCREPANCY' AND t.source = 'PLATFORM'), 0) AS "withdrawalDiscrepancyPHigherAmount",
      count(*) FILTER (WHERE t.type = 'DEPOSIT' AND (t."isInternalTransferAuto" OR t."reviewCategory" = 'INTERNAL_TRANSFER'))::int AS "internalDepositCount",
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT' AND (t."isInternalTransferAuto" OR t."reviewCategory" = 'INTERNAL_TRANSFER')), 0) AS "internalDepositAmount",
      count(*) FILTER (WHERE t.type = 'WITHDRAWAL' AND (t."isInternalTransferAuto" OR t."reviewCategory" = 'INTERNAL_TRANSFER'))::int AS "internalWithdrawalCount",
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL' AND (t."isInternalTransferAuto" OR t."reviewCategory" = 'INTERNAL_TRANSFER')), 0) AS "internalWithdrawalAmount"
    FROM "transactions" t
    WHERE ${predicates.join(' AND ')}
    GROUP BY t."accountId", t.currency
  `
  return db.$queryRawUnsafe(sql, ...values) as Promise<FinancialAggregate[]>
}

type ReadModelState = { value: string }

async function financialReadModelIsReady(): Promise<boolean> {
  try {
    const rows = await db.$queryRawUnsafe(
      `SELECT "value" FROM "performance_backfill_state" WHERE "key" = $1 LIMIT 1`,
      'financial-read-model-v1',
    ) as ReadModelState[]
    return Boolean(rows[0]?.value)
  } catch {
    // Expand migration/backfill has not completed yet. The direct aggregate is
    // intentionally retained as a correct, zero-downtime fallback.
    return false
  }
}

async function getSummaryFinancialAggregates(
  options: FinancialAggregateOptions,
): Promise<FinancialAggregate[]> {
  const values: unknown[] = []
  const bind = (value: unknown) => {
    values.push(value)
    return `$${values.length}`
  }
  const predicates: string[] = []
  if (options.accountIds) {
    if (options.accountIds.length === 0) return []
    predicates.push(`s."accountId" = ANY(${bind(options.accountIds)}::text[])`)
  }
  if (options.dateFrom) predicates.push(`s."businessDate" >= ${bind(damascusDateStr(options.dateFrom))}::date`)
  if (options.dateToExclusive) {
    predicates.push(`s."businessDate" < ${bind(damascusDateStr(options.dateToExclusive))}::date`)
  }

  const sql = `
    SELECT
      s."accountId" AS "accountId", s.currency,
      COALESCE(sum(s."matchedDepositCount"), 0)::int AS "matchedDepositCount",
      COALESCE(sum(s."matchedDepositAmount"), 0) AS "matchedDepositAmount",
      COALESCE(sum(s."matchedWithdrawalCount"), 0)::int AS "matchedWithdrawalCount",
      COALESCE(sum(s."matchedWithdrawalAmount"), 0) AS "matchedWithdrawalAmount",
      COALESCE(sum(s."pendingScCount"), 0)::int AS "pendingScCount",
      COALESCE(sum(s."pendingScAmount"), 0) AS "pendingScAmount",
      COALESCE(sum(s."pendingPCount"), 0)::int AS "pendingPCount",
      COALESCE(sum(s."pendingPAmount"), 0) AS "pendingPAmount",
      COALESCE(sum(s."discrepancyCount"), 0)::int AS "discrepancyCount",
      COALESCE(sum(s."discrepancyAmount"), 0) AS "discrepancyAmount",
      COALESCE(sum(s."depositWasteAmount"), 0) AS "depositWasteAmount",
      COALESCE(sum(s."withdrawalWasteAmount"), 0) AS "withdrawalWasteAmount",
      COALESCE(sum(s."depositExtrasAmount"), 0) AS "depositExtrasAmount",
      COALESCE(sum(s."withdrawalExtrasAmount"), 0) AS "withdrawalExtrasAmount",
      COALESCE(sum(s."depositPlatformOnlyAmount"), 0) AS "depositPlatformOnlyAmount",
      COALESCE(sum(s."depositDiscrepancyPHigherAmount"), 0) AS "depositDiscrepancyPHigherAmount",
      COALESCE(sum(s."withdrawalScOnlyAmount"), 0) AS "withdrawalScOnlyAmount",
      COALESCE(sum(s."withdrawalDiscrepancySCHigherAmount"), 0) AS "withdrawalDiscrepancySCHigherAmount",
      COALESCE(sum(s."depositScOnlyAmount"), 0) AS "depositScOnlyAmount",
      COALESCE(sum(s."depositDiscrepancySCHigherAmount"), 0) AS "depositDiscrepancySCHigherAmount",
      COALESCE(sum(s."withdrawalPlatformOnlyAmount"), 0) AS "withdrawalPlatformOnlyAmount",
      COALESCE(sum(s."withdrawalDiscrepancyPHigherAmount"), 0) AS "withdrawalDiscrepancyPHigherAmount",
      COALESCE(sum(s."internalDepositCount"), 0)::int AS "internalDepositCount",
      COALESCE(sum(s."internalDepositAmount"), 0) AS "internalDepositAmount",
      COALESCE(sum(s."internalWithdrawalCount"), 0)::int AS "internalWithdrawalCount",
      COALESCE(sum(s."internalWithdrawalAmount"), 0) AS "internalWithdrawalAmount"
    FROM "financial_daily_summaries" s
    WHERE ${predicates.join(' AND ') || 'TRUE'}
    GROUP BY s."accountId", s.currency
  `
  return db.$queryRawUnsafe(sql, ...values) as Promise<FinancialAggregate[]>
}

/**
 * Once the resumable backfill has marked the read model complete, reports use
 * compact Damascus-day buckets instead of scanning transactions. During the
 * expand/backfill phase this automatically falls back to the exact base-table
 * query, so a deploy never serves a partial financial total.
 */
export async function getFinancialAggregates(
  options: FinancialAggregateOptions = {},
): Promise<FinancialAggregate[]> {
  if (!(await financialReadModelIsReady())) return getDirectFinancialAggregates(options)
  try {
    return await getSummaryFinancialAggregates(options)
  } catch {
    console.warn('Financial read model unavailable; using direct aggregate fallback.')
    return getDirectFinancialAggregates(options)
  }
}

export function decimal(value: unknown): number {
  return Number(value || 0)
}
