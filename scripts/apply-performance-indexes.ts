/**
 * Applies long-running production indexes outside Prisma Migrate.
 *
 * PostgreSQL rejects CREATE INDEX CONCURRENTLY inside a transaction. Run this
 * once after the expand migration with DIRECT_DATABASE_URL set to Neon's
 * direct host. Every statement is independently idempotent and resumable.
 */
import { PrismaClient } from '@prisma/client'

const databaseUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Set DIRECT_DATABASE_URL (preferred) or DATABASE_URL before running this script.')
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl })

const statements = [
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "transactions_matchedTxId_idx" ON "transactions" ("matchedTxId")`,
  'CREATE EXTENSION IF NOT EXISTS pg_trgm',
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "transactions_reconciliation_queue_idx"
     ON "transactions" ("accountId", "txDateTime" DESC, "id" DESC)
     WHERE "status" IN ('PENDING_SC', 'PENDING_P', 'DISCREPANCY')
       AND "isInternalTransferAuto" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "transactions_pending_match_idx"
     ON "transactions" ("accountId", "status", "type", "currency", "txDateTime")
     WHERE "matchedTxId" IS NULL
       AND "status" IN ('PENDING_SC', 'PENDING_P')`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "transactions_account_currency_time_id_idx"
     ON "transactions" ("accountId", "currency", "txDateTime" DESC, "id" DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "transactions_platform_tx_id_idx"
     ON "transactions" ("platformTxId") WHERE "platformTxId" IS NOT NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "transactions_sham_cash_tx_id_trgm_idx"
     ON "transactions" USING GIN ("shamCashTxId" gin_trgm_ops) WHERE "shamCashTxId" IS NOT NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "transactions_platform_tx_id_trgm_idx"
     ON "transactions" USING GIN ("platformTxId" gin_trgm_ops) WHERE "platformTxId" IS NOT NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "transactions_platform_user_id_trgm_idx"
     ON "transactions" USING GIN ("platformUserId" gin_trgm_ops) WHERE "platformUserId" IS NOT NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "transactions_customer_name_trgm_idx"
     ON "transactions" USING GIN ("customerName" gin_trgm_ops) WHERE "customerName" IS NOT NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "customer_summaries_customer_name_trgm_idx"
     ON "customer_summaries" USING GIN ("customerName" gin_trgm_ops)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "upload_batches_created_at_idx"
     ON "upload_batches" ("createdAt" DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "upload_batches_account_created_at_idx"
     ON "upload_batches" ("accountId", "createdAt" DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "expenses_active_date_idx"
     ON "expenses" ("expenseDate" DESC) WHERE "deletedAt" IS NULL`,
]

async function main() {
  for (const statement of statements) {
    const name = statement.match(/"([^"]+_idx)"/)?.[1] || statement.slice(0, 48)
    process.stdout.write(`Applying ${name}... `)
    await prisma.$executeRawUnsafe(statement)
    process.stdout.write('done\n')
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
