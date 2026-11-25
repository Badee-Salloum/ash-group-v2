/**
 * One-time, idempotent enrichment of the small duplicate review read model.
 * Run after the additive migration, before deploying the new list contract.
 * Uses Neon HTTP so no long-lived pooled connection is required. Only summary
 * rows are updated; transaction amounts, links and classifications are untouched.
 * Usage: DATABASE_URL=... npx tsx scripts/backfill-currency-mismatch-groups.ts
 */
import { neon } from '@neondatabase/serverless'
import { duplicatePairCountSql, currencyMismatchSql } from '../src/lib/reconciliation/duplicateReview'

const databaseUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Set DIRECT_DATABASE_URL or DATABASE_URL.')
const sql = neon(databaseUrl)

async function main() {
  // The expensive discovery is a release step, never part of a page request.
  // Candidate identity is materialized once; the aggregate then covers every
  // row of those groups, including reviewed WASTE/RETURNS counterparts.
  const result = await sql.query(`
    WITH candidates AS MATERIALIZED (
      SELECT DISTINCT t."accountId", t."shamCashTxId"
      FROM "transactions" t
      JOIN "transactions" m ON m.id = t."matchedTxId"
      WHERE t."shamCashTxId" IS NOT NULL
        AND upper(btrim(t.currency)) <> upper(btrim(m.currency))
    ), updated AS (
      INSERT INTO "duplicate_sc_groups"
        ("id", "accountId", "shamCashTxId", "pairCount", "hasCurrencyMismatch", "lastSeenAt", "refreshedAt")
      SELECT md5(concat_ws('|', t."accountId", t."shamCashTxId")),
        t."accountId", t."shamCashTxId", (${duplicatePairCountSql})::int,
        ${currencyMismatchSql}, max(t."txDateTime"), CURRENT_TIMESTAMP
      FROM candidates c
      JOIN "transactions" t
        ON t."accountId" = c."accountId" AND t."shamCashTxId" = c."shamCashTxId"
      LEFT JOIN "transactions" m ON m.id = t."matchedTxId"
      GROUP BY t."accountId", t."shamCashTxId"
      HAVING ${currencyMismatchSql}
      ON CONFLICT ("accountId", "shamCashTxId") DO UPDATE SET
        "pairCount" = EXCLUDED."pairCount",
        "hasCurrencyMismatch" = EXCLUDED."hasCurrencyMismatch",
        "lastSeenAt" = EXCLUDED."lastSeenAt", "refreshedAt" = CURRENT_TIMESTAMP
      RETURNING id
    ) SELECT count(*)::int AS "updatedGroups" FROM updated
  `)
  console.log(JSON.stringify(result[0]))
}

main().catch(() => {
  // Never print a connection string or financial data on a failed release.
  console.error('Currency-mismatch group backfill failed. No transaction rows were modified.')
  process.exitCode = 1
})
