/**
 * Resumable, idempotent performance backfill.
 *
 * Usage:
 *   DIRECT_DATABASE_URL='...' npx tsx scripts/backfill-performance-read-models.ts
 *   DIRECT_DATABASE_URL='...' npx tsx scripts/backfill-performance-read-models.ts --refresh-only
 */
import { PrismaClient } from '@prisma/client'
import { duplicatePairCountSql, currencyMismatchSql } from '../src/lib/reconciliation/duplicateReview'

const databaseUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Set DIRECT_DATABASE_URL (preferred) or DATABASE_URL.')

const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
const BATCH_SIZE = 2_000
const refreshOnly = process.argv.includes('--refresh-only')

type Checkpoint = { value: string }
type Updated = { id: string }

async function ensureStateTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "performance_backfill_state" (
      "key" TEXT PRIMARY KEY,
      "value" TEXT NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

async function markFinancialReadModelIncomplete() {
  // Do this before changing either derived fields or summaries.  A dashboard
  // request then takes the exact base-table fallback instead of ever observing
  // a truncated/partially rebuilt summary table.
  await prisma.$executeRawUnsafe(
    'DELETE FROM "performance_backfill_state" WHERE "key" = $1',
    'financial-read-model-v1',
  )
}

async function loadCheckpoint(): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Checkpoint[]>(
    'SELECT "value" FROM "performance_backfill_state" WHERE "key" = $1',
    'transaction-derived-fields-v1',
  )
  return rows[0]?.value || ''
}

async function saveCheckpoint(value: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "performance_backfill_state" ("key", "value", "updatedAt")
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP`,
    'transaction-derived-fields-v1',
    value,
  )
}

async function backfillDerivedFields() {
  let cursor = await loadCheckpoint()
  let total = 0
  for (;;) {
    const updated = await prisma.$queryRawUnsafe<Updated[]>(`
      WITH target AS (
        SELECT t.id
        FROM "transactions" t
        WHERE t.id > $1
        ORDER BY t.id
        LIMIT $2
      )
      UPDATE "transactions" t
      SET
        "customerName" = COALESCE(
          NULLIF(BTRIM(t."rawData"->>'accountName'), ''),
          NULLIF(BTRIM(t."rawData"->'sc'->>'accountName'), '')
        ),
        "isInternalTransferAuto" = lower(COALESCE(t.notes, '')) LIKE '%internal-transfer%'
          OR EXISTS (
          SELECT 1
          FROM "accounts" a, unnest(a."walletIdentifiers") AS wallet(identifier)
          WHERE a.id = t."accountId"
            AND BTRIM(wallet.identifier) <> ''
            AND NOT EXISTS (
              SELECT 1
              FROM regexp_split_to_table(BTRIM(wallet.identifier), E'\\s+') AS wallet_word(word)
              WHERE wallet_word.word <> ''
                AND (
                  (length(wallet_word.word) >= 2
                    AND position(lower(wallet_word.word) IN lower(concat_ws(' ',
                      COALESCE(NULLIF(t."rawData"->>'accountNumber', ''), NULLIF(t."rawData"->'sc'->>'accountNumber', ''), ''),
                      COALESCE(NULLIF(t."rawData"->>'accountName', ''), NULLIF(t."rawData"->'sc'->>'accountName', ''), ''),
                      COALESCE(NULLIF(t."rawData"->>'notes', ''), NULLIF(t."rawData"->'sc'->>'notes', ''), '')
                    ))) = 0)
                  OR
                  (length(wallet_word.word) = 1
                    AND NOT (lower(wallet_word.word) = ANY(regexp_split_to_array(lower(concat_ws(' ',
                      COALESCE(NULLIF(t."rawData"->>'accountNumber', ''), NULLIF(t."rawData"->'sc'->>'accountNumber', ''), ''),
                      COALESCE(NULLIF(t."rawData"->>'accountName', ''), NULLIF(t."rawData"->'sc'->>'accountName', ''), ''),
                      COALESCE(NULLIF(t."rawData"->>'notes', ''), NULLIF(t."rawData"->'sc'->>'notes', ''), '')
                    )), E'\\s+'))))
                )
            )
        )
      FROM target
      WHERE t.id = target.id
      RETURNING t.id
    `, cursor, BATCH_SIZE)

    if (updated.length === 0) break
    cursor = updated[updated.length - 1].id
    total += updated.length
    await saveCheckpoint(cursor)
    console.log(`Derived fields: ${total.toLocaleString()} rows processed; checkpoint ${cursor}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

async function refreshReadModels() {
  // These tables are additive. Their ready marker was cleared before this
  // phase, so rebuilding never changes base transaction data and an
  // interruption is safe: application reads use the exact base-table
  // fallback until this whole, idempotent phase finishes successfully.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "financial_daily_summaries", "customer_summaries", "duplicate_sc_groups"')

  await prisma.$executeRawUnsafe(`
    INSERT INTO "financial_daily_summaries" (
      "id", "businessDate", "accountId", "currency",
      "matchedDepositCount", "matchedDepositAmount", "matchedWithdrawalCount", "matchedWithdrawalAmount",
      "pendingScCount", "pendingScAmount",
      "pendingPCount", "pendingPAmount", "discrepancyCount", "discrepancyAmount",
      "depositWasteAmount", "withdrawalWasteAmount", "depositExtrasAmount", "withdrawalExtrasAmount",
      "depositPlatformOnlyAmount", "depositDiscrepancyPHigherAmount",
      "withdrawalScOnlyAmount", "withdrawalDiscrepancySCHigherAmount",
      "depositScOnlyAmount", "depositDiscrepancySCHigherAmount",
      "withdrawalPlatformOnlyAmount", "withdrawalDiscrepancyPHigherAmount",
      "internalDepositCount", "internalDepositAmount", "internalWithdrawalCount", "internalWithdrawalAmount", "refreshedAt"
    )
    SELECT
      md5(concat_ws('|', (((t."txDateTime" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Damascus')::date)::text, t."accountId", t.currency)),
      ((t."txDateTime" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Damascus')::date,
      t."accountId", t.currency,
      count(*) FILTER (WHERE t.status = 'MATCHED' AND t.source = 'SHAM_CASH' AND t.type = 'DEPOSIT' AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER'))::int,
      COALESCE(sum(t.amount) FILTER (WHERE t.status = 'MATCHED' AND t.source = 'SHAM_CASH' AND t.type = 'DEPOSIT' AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0),
      count(*) FILTER (WHERE t.status = 'MATCHED' AND t.source = 'SHAM_CASH' AND t.type = 'WITHDRAWAL' AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER'))::int,
      COALESCE(sum(t.amount) FILTER (WHERE t.status = 'MATCHED' AND t.source = 'SHAM_CASH' AND t.type = 'WITHDRAWAL' AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0),
      count(*) FILTER (WHERE t.status = 'PENDING_SC' AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER'))::int,
      COALESCE(sum(t.amount) FILTER (WHERE t.status = 'PENDING_SC' AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0),
      count(*) FILTER (WHERE t.status = 'PENDING_P')::int,
      COALESCE(sum(t.amount) FILTER (WHERE t.status = 'PENDING_P'), 0),
      count(*) FILTER (WHERE t.status = 'DISCREPANCY' AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER'))::int,
      COALESCE(sum(COALESCE(t."amountDiff", t.amount)) FILTER (WHERE t.status = 'DISCREPANCY' AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0),
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'PENDING_P' AND t.source = 'PLATFORM'), 0)
        + COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'DISCREPANCY' AND t.source = 'PLATFORM'), 0)
        ,
      COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'DISCREPANCY' AND t.source = 'SHAM_CASH'), 0)
        + COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'PENDING_SC' AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0),
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'PENDING_SC' AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0)
        + COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'DISCREPANCY' AND t.source = 'SHAM_CASH'), 0)
        ,
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'PENDING_P'), 0)
        + COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'DISCREPANCY' AND t.source = 'PLATFORM'), 0),
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'PENDING_P' AND t.source = 'PLATFORM'), 0),
      COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'DISCREPANCY' AND t.source = 'PLATFORM'), 0),
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'PENDING_SC' AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0),
      COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'DISCREPANCY' AND t.source = 'SHAM_CASH'), 0),
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'PENDING_SC' AND t."isInternalTransferAuto" = false AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'INTERNAL_TRANSFER')), 0),
      COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'DEPOSIT' AND t.status = 'DISCREPANCY' AND t.source = 'SHAM_CASH'), 0),
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'PENDING_P'), 0),
      COALESCE(sum(t."amountDiff") FILTER (WHERE t.type = 'WITHDRAWAL' AND t.status = 'DISCREPANCY' AND t.source = 'PLATFORM'), 0),
      count(*) FILTER (WHERE t.type = 'DEPOSIT' AND (t."isInternalTransferAuto" OR t."reviewCategory" = 'INTERNAL_TRANSFER'))::int,
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'DEPOSIT' AND (t."isInternalTransferAuto" OR t."reviewCategory" = 'INTERNAL_TRANSFER')), 0),
      count(*) FILTER (WHERE t.type = 'WITHDRAWAL' AND (t."isInternalTransferAuto" OR t."reviewCategory" = 'INTERNAL_TRANSFER'))::int,
      COALESCE(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL' AND (t."isInternalTransferAuto" OR t."reviewCategory" = 'INTERNAL_TRANSFER')), 0),
      CURRENT_TIMESTAMP
    FROM "transactions" t
    WHERE t."reviewCategory" IS NULL OR t."reviewCategory" <> 'COMPLAINT'
    GROUP BY 2, 3, 4
  `)

  await prisma.$executeRawUnsafe(`
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
    WHERE t."customerName" IS NOT NULL
      AND t."customerName" <> ''
      AND NOT t."isInternalTransferAuto"
      AND (t."reviewCategory" IS NULL OR t."reviewCategory" <> 'COMPLAINT')
    GROUP BY t."customerName", t."accountId", t.currency
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "duplicate_sc_groups" ("id", "accountId", "shamCashTxId", "pairCount", "hasCurrencyMismatch", "lastSeenAt", "refreshedAt")
    SELECT
      md5(concat_ws('|', t."accountId", t."shamCashTxId")),
      t."accountId", t."shamCashTxId",
      (${duplicatePairCountSql})::int,
      ${currencyMismatchSql},
      max(t."txDateTime"), CURRENT_TIMESTAMP
    FROM "transactions" t
    LEFT JOIN "transactions" m ON m.id = t."matchedTxId"
    WHERE t."shamCashTxId" IS NOT NULL
    GROUP BY t."accountId", t."shamCashTxId"
    HAVING (${duplicatePairCountSql}) > 1 OR ${currencyMismatchSql}
  `)

  await prisma.$executeRawUnsafe(
    `INSERT INTO "performance_backfill_state" ("key", "value", "updatedAt")
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP`,
    'financial-read-model-v1',
    new Date().toISOString(),
  )
}

async function main() {
  await ensureStateTable()
  await markFinancialReadModelIncomplete()
  if (!refreshOnly) await backfillDerivedFields()
  await refreshReadModels()
  console.log('Performance read models refreshed successfully.')
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
