import { db } from '@/lib/db/client'
import { damascusDateStr } from '@/lib/datetime'
import type { Prisma } from '@prisma/client'
import { duplicatePairCountSql, currencyMismatchSql } from '@/lib/reconciliation/duplicateReview'

/**
 * Minimal transaction identity needed to maintain the additive read models.
 * Callers pass the before and/or after value of every changed row so a delete,
 * re-link, or status change refreshes its old customer/day group as well.
 */
export type ChangedTransaction = {
  accountId: string
  txDateTime: Date | string
  customerName?: string | null
  shamCashTxId?: string | null
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value))))
}

async function refreshCustomerSummaries(changes: ChangedTransaction[]) {
  const accountIds = unique(changes.map(change => change.accountId))
  const customerNames = unique(changes.map(change => change.customerName))
  if (accountIds.length === 0 || customerNames.length === 0) return

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    // Delete first because a changed row may now be excluded (internal or
    // complaint), leaving no qualifying source rows for a previous summary.
    await tx.$executeRawUnsafe(`
      DELETE FROM "customer_summaries"
      WHERE "accountId" = ANY($1::text[])
        AND "customerName" = ANY($2::text[])
    `, accountIds, customerNames)

    await tx.$executeRawUnsafe(`
      INSERT INTO "customer_summaries" (
        "id", "customerName", "accountId", "currency", "depositCount", "depositAmount",
        "withdrawalCount", "withdrawalAmount", "matchedCount", "pendingCount", "discrepancyCount",
        "firstSeen", "lastSeen", "refreshedAt"
      )
      SELECT
        md5(concat_ws('|', t."customerName", t."accountId", t.currency)),
        t."customerName", t."accountId", t.currency,
        count(*) FILTER (WHERE t.type = 'DEPOSIT')::int,
        COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT'), 0),
        count(*) FILTER (WHERE t.type = 'WITHDRAWAL')::int,
        COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL'), 0),
        count(*) FILTER (WHERE t.status = 'MATCHED')::int,
        count(*) FILTER (WHERE t.status IN ('PENDING_SC', 'PENDING_P'))::int,
        count(*) FILTER (WHERE t.status = 'DISCREPANCY')::int,
        min(t."txDateTime"), max(t."txDateTime"), CURRENT_TIMESTAMP
      FROM "transactions" t
      WHERE t."accountId" = ANY($1::text[])
        AND t."customerName" = ANY($2::text[])
        AND t."customerName" <> ''
        AND NOT t."isInternalTransferAuto"
        AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'COMPLAINT')
      GROUP BY t."customerName", t."accountId", t.currency
      ON CONFLICT ("customerName", "accountId", "currency") DO UPDATE SET
        "depositCount" = EXCLUDED."depositCount",
        "depositAmount" = EXCLUDED."depositAmount",
        "withdrawalCount" = EXCLUDED."withdrawalCount",
        "withdrawalAmount" = EXCLUDED."withdrawalAmount",
        "matchedCount" = EXCLUDED."matchedCount",
        "pendingCount" = EXCLUDED."pendingCount",
        "discrepancyCount" = EXCLUDED."discrepancyCount",
        "firstSeen" = EXCLUDED."firstSeen",
        "lastSeen" = EXCLUDED."lastSeen",
        "refreshedAt" = EXCLUDED."refreshedAt"
    `, accountIds, customerNames)
  })
}

async function refreshDuplicateGroups(changes: ChangedTransaction[]) {
  const accountIds = unique(changes.map(change => change.accountId))
  const shamCashTxIds = unique(changes.map(change => change.shamCashTxId))
  if (accountIds.length === 0 || shamCashTxIds.length === 0) return

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRawUnsafe(`
      DELETE FROM "duplicate_sc_groups"
      WHERE "accountId" = ANY($1::text[])
        AND "shamCashTxId" = ANY($2::text[])
    `, accountIds, shamCashTxIds)
    await tx.$executeRawUnsafe(`
      INSERT INTO "duplicate_sc_groups" ("id", "accountId", "shamCashTxId", "pairCount", "hasCurrencyMismatch", "lastSeenAt", "refreshedAt")
      SELECT
        md5(concat_ws('|', t."accountId", t."shamCashTxId")),
        t."accountId", t."shamCashTxId",
        (${duplicatePairCountSql})::int,
        ${currencyMismatchSql},
        max(t."txDateTime"), CURRENT_TIMESTAMP
      FROM "transactions" t
      LEFT JOIN "transactions" m ON m.id = t."matchedTxId"
      WHERE t."accountId" = ANY($1::text[])
        AND t."shamCashTxId" = ANY($2::text[])
      GROUP BY t."accountId", t."shamCashTxId"
      HAVING (${duplicatePairCountSql}) > 1 OR ${currencyMismatchSql}
      ON CONFLICT ("accountId", "shamCashTxId") DO UPDATE SET
        "pairCount" = EXCLUDED."pairCount",
        "hasCurrencyMismatch" = EXCLUDED."hasCurrencyMismatch",
        "lastSeenAt" = EXCLUDED."lastSeenAt",
        "refreshedAt" = EXCLUDED."refreshedAt"
    `, accountIds, shamCashTxIds)
  })
}

async function refreshFinancialDailySummaries(changes: ChangedTransaction[]) {
  const accountIds = unique(changes.map(change => change.accountId))
  const businessDates = unique(changes.flatMap(change => {
    const date = new Date(change.txDateTime)
    if (Number.isNaN(date.getTime())) return []
    // Expand across both old and corrected keys during the date-key rollout.
    // PostgreSQL timestamp-without-time-zone stores UTC here; the old SQL
    // interpreted it as Damascus time, moving it three hours backwards.
    return [damascusDateStr(date), new Date(date.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)]
  }))
  if (accountIds.length === 0 || businessDates.length === 0) return

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRawUnsafe(`
      DELETE FROM "financial_daily_summaries"
      WHERE "accountId" = ANY($1::text[])
        AND "businessDate" = ANY($2::date[])
    `, accountIds, businessDates)
    await tx.$executeRawUnsafe(`
      INSERT INTO "financial_daily_summaries" (
        "id", "businessDate", "accountId", "currency",
        "matchedDepositCount", "matchedDepositAmount", "matchedWithdrawalCount", "matchedWithdrawalAmount",
        "pendingScCount", "pendingScAmount", "pendingPCount", "pendingPAmount",
        "discrepancyCount", "discrepancyAmount",
        "depositWasteAmount", "withdrawalWasteAmount", "depositExtrasAmount", "withdrawalExtrasAmount",
        "depositPlatformOnlyAmount", "depositDiscrepancyPHigherAmount",
        "withdrawalScOnlyAmount", "withdrawalDiscrepancySCHigherAmount",
        "depositScOnlyAmount", "depositDiscrepancySCHigherAmount",
        "withdrawalPlatformOnlyAmount", "withdrawalDiscrepancyPHigherAmount",
        "internalDepositCount", "internalDepositAmount", "internalWithdrawalCount", "internalWithdrawalAmount", "refreshedAt"
      )
      SELECT
        md5(concat_ws('|', (((t."txDateTime" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Damascus')::date)::text, t."accountId", t.currency)),
        ((t."txDateTime" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Damascus')::date, t."accountId", t.currency,
        count(*) FILTER (WHERE t.status = 'MATCHED' AND t.source = 'SHAM_CASH' AND t.type = 'DEPOSIT'
          AND NOT t."isInternalTransferAuto" AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER'))::int,
        COALESCE(sum(t.amount) FILTER (WHERE t.status = 'MATCHED' AND t.source = 'SHAM_CASH' AND t.type = 'DEPOSIT'
          AND NOT t."isInternalTransferAuto" AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0),
        count(*) FILTER (WHERE t.status = 'MATCHED' AND t.source = 'SHAM_CASH' AND t.type = 'WITHDRAWAL'
          AND NOT t."isInternalTransferAuto" AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER'))::int,
        COALESCE(sum(t.amount) FILTER (WHERE t.status = 'MATCHED' AND t.source = 'SHAM_CASH' AND t.type = 'WITHDRAWAL'
          AND NOT t."isInternalTransferAuto" AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0),
        count(*) FILTER (WHERE t.status = 'PENDING_SC' AND NOT t."isInternalTransferAuto"
          AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER'))::int,
        COALESCE(sum(t.amount) FILTER (WHERE t.status = 'PENDING_SC' AND NOT t."isInternalTransferAuto"
          AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0),
        count(*) FILTER (WHERE t.status = 'PENDING_P')::int,
        COALESCE(sum(t.amount) FILTER (WHERE t.status = 'PENDING_P'), 0),
        count(*) FILTER (WHERE t.status = 'DISCREPANCY' AND NOT t."isInternalTransferAuto"
          AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER'))::int,
        COALESCE(sum(COALESCE(t."amountDiff", t.amount)) FILTER (WHERE t.status = 'DISCREPANCY' AND NOT t."isInternalTransferAuto"
          AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0),
        COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'PENDING_P' AND t.source = 'PLATFORM'), 0)
          + COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'DISCREPANCY' AND t.source = 'PLATFORM'), 0),
        COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'DISCREPANCY' AND t.source = 'SHAM_CASH'), 0)
          + COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'PENDING_SC' AND NOT t."isInternalTransferAuto"
            AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0),
        COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'PENDING_SC' AND NOT t."isInternalTransferAuto"
          AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0)
          + COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'DISCREPANCY' AND t.source = 'SHAM_CASH'), 0),
        COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'PENDING_P'), 0)
          + COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'DISCREPANCY' AND t.source = 'PLATFORM'), 0),
        COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'PENDING_P' AND t.source = 'PLATFORM'), 0),
        COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'DISCREPANCY' AND t.source = 'PLATFORM'), 0),
        COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'PENDING_SC' AND NOT t."isInternalTransferAuto"
          AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0),
        COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'DISCREPANCY' AND t.source = 'SHAM_CASH'), 0),
        COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'PENDING_SC' AND NOT t."isInternalTransferAuto"
          AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0),
        COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'DISCREPANCY' AND t.source = 'SHAM_CASH'), 0),
        COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'PENDING_P'), 0),
        COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'DISCREPANCY' AND t.source = 'PLATFORM'), 0),
        count(*) FILTER (WHERE t.type = 'DEPOSIT' AND (t."isInternalTransferAuto" OR t."reviewCategory" = 'INTERNAL_TRANSFER'))::int,
        COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT' AND (t."isInternalTransferAuto" OR t."reviewCategory" = 'INTERNAL_TRANSFER')), 0),
        count(*) FILTER (WHERE t.type = 'WITHDRAWAL' AND (t."isInternalTransferAuto" OR t."reviewCategory" = 'INTERNAL_TRANSFER'))::int,
        COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL' AND (t."isInternalTransferAuto" OR t."reviewCategory" = 'INTERNAL_TRANSFER')), 0),
        CURRENT_TIMESTAMP
      FROM "transactions" t
      WHERE t."accountId" = ANY($1::text[])
        AND ((t."txDateTime" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Damascus')::date = ANY($2::date[])
        AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'COMPLAINT')
      GROUP BY 2, 3, 4
      ON CONFLICT ("businessDate", "accountId", "currency") DO UPDATE SET
        "matchedDepositCount" = EXCLUDED."matchedDepositCount",
        "matchedDepositAmount" = EXCLUDED."matchedDepositAmount",
        "matchedWithdrawalCount" = EXCLUDED."matchedWithdrawalCount",
        "matchedWithdrawalAmount" = EXCLUDED."matchedWithdrawalAmount",
        "pendingScCount" = EXCLUDED."pendingScCount",
        "pendingScAmount" = EXCLUDED."pendingScAmount",
        "pendingPCount" = EXCLUDED."pendingPCount",
        "pendingPAmount" = EXCLUDED."pendingPAmount",
        "discrepancyCount" = EXCLUDED."discrepancyCount",
        "discrepancyAmount" = EXCLUDED."discrepancyAmount",
        "depositWasteAmount" = EXCLUDED."depositWasteAmount",
        "withdrawalWasteAmount" = EXCLUDED."withdrawalWasteAmount",
        "depositExtrasAmount" = EXCLUDED."depositExtrasAmount",
        "withdrawalExtrasAmount" = EXCLUDED."withdrawalExtrasAmount",
        "depositPlatformOnlyAmount" = EXCLUDED."depositPlatformOnlyAmount",
        "depositDiscrepancyPHigherAmount" = EXCLUDED."depositDiscrepancyPHigherAmount",
        "withdrawalScOnlyAmount" = EXCLUDED."withdrawalScOnlyAmount",
        "withdrawalDiscrepancySCHigherAmount" = EXCLUDED."withdrawalDiscrepancySCHigherAmount",
        "depositScOnlyAmount" = EXCLUDED."depositScOnlyAmount",
        "depositDiscrepancySCHigherAmount" = EXCLUDED."depositDiscrepancySCHigherAmount",
        "withdrawalPlatformOnlyAmount" = EXCLUDED."withdrawalPlatformOnlyAmount",
        "withdrawalDiscrepancyPHigherAmount" = EXCLUDED."withdrawalDiscrepancyPHigherAmount",
        "internalDepositCount" = EXCLUDED."internalDepositCount",
        "internalDepositAmount" = EXCLUDED."internalDepositAmount",
        "internalWithdrawalCount" = EXCLUDED."internalWithdrawalCount",
        "internalWithdrawalAmount" = EXCLUDED."internalWithdrawalAmount",
        "refreshedAt" = EXCLUDED."refreshedAt"
    `, accountIds, businessDates)
  })
}

/**
 * Keep additive read models fresh immediately after known writes. A failure is
 * logged without identifiers and never rolls back the financial write itself;
 * the resumable backfill remains the recovery path.
 */
export async function syncTransactionReadModels(changes: ChangedTransaction[]) {
  if (changes.length === 0) return true
  const results = await Promise.allSettled([
    refreshCustomerSummaries(changes),
    refreshDuplicateGroups(changes),
    refreshFinancialDailySummaries(changes),
  ])
  if (results.some(result => result.status === 'rejected')) {
    console.warn('Transaction read-model refresh failed; resumable backfill will repair it.')
    return false
  }
  return true
}
