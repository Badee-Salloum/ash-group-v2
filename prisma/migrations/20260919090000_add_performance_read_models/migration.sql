-- Expand-only performance migration.  The accompanying backfill and
-- concurrent-index script are intentionally separate so deployment never
-- holds a long transaction or blocks the production transactions table.

ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "customerName" TEXT,
  ADD COLUMN IF NOT EXISTS "isInternalTransferAuto" BOOLEAN NOT NULL DEFAULT false;

-- This state row is deliberately separate from the data tables.  The runtime
-- only reads financial_daily_summaries after the resumable backfill sets its
-- ready marker, so an interrupted rebuild always falls back to transactions.
CREATE TABLE IF NOT EXISTS "performance_backfill_state" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_backfill_state_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "financial_daily_summaries" (
  "id" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "accountId" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "matchedDepositCount" INTEGER NOT NULL DEFAULT 0,
  "matchedDepositAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "matchedWithdrawalCount" INTEGER NOT NULL DEFAULT 0,
  "matchedWithdrawalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "pendingScCount" INTEGER NOT NULL DEFAULT 0,
  "pendingScAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "pendingPCount" INTEGER NOT NULL DEFAULT 0,
  "pendingPAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "discrepancyCount" INTEGER NOT NULL DEFAULT 0,
  "discrepancyAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "depositWasteAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "withdrawalWasteAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "depositExtrasAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "withdrawalExtrasAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "depositPlatformOnlyAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "depositDiscrepancyPHigherAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "withdrawalScOnlyAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "withdrawalDiscrepancySCHigherAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "depositScOnlyAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "depositDiscrepancySCHigherAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "withdrawalPlatformOnlyAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "withdrawalDiscrepancyPHigherAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "internalDepositCount" INTEGER NOT NULL DEFAULT 0,
  "internalDepositAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "internalWithdrawalCount" INTEGER NOT NULL DEFAULT 0,
  "internalWithdrawalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "financial_daily_summaries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "financial_daily_summaries_businessDate_accountId_currency_key"
  ON "financial_daily_summaries"("businessDate", "accountId", "currency");
CREATE INDEX IF NOT EXISTS "financial_daily_summaries_accountId_businessDate_idx"
  ON "financial_daily_summaries"("accountId", "businessDate");

-- Kept idempotent for a deployment where an earlier additive build made the
-- table before the detailed profit-breakdown columns were introduced.
ALTER TABLE "financial_daily_summaries"
  ADD COLUMN IF NOT EXISTS "depositPlatformOnlyAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "depositDiscrepancyPHigherAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "withdrawalScOnlyAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "withdrawalDiscrepancySCHigherAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "depositScOnlyAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "depositDiscrepancySCHigherAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "withdrawalPlatformOnlyAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "withdrawalDiscrepancyPHigherAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "customer_summaries" (
  "id" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "depositCount" INTEGER NOT NULL DEFAULT 0,
  "depositAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "withdrawalCount" INTEGER NOT NULL DEFAULT 0,
  "withdrawalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "matchedCount" INTEGER NOT NULL DEFAULT 0,
  "pendingCount" INTEGER NOT NULL DEFAULT 0,
  "discrepancyCount" INTEGER NOT NULL DEFAULT 0,
  "firstSeen" TIMESTAMP(3) NOT NULL,
  "lastSeen" TIMESTAMP(3) NOT NULL,
  "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_summaries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "customer_summaries_customerName_accountId_currency_key"
  ON "customer_summaries"("customerName", "accountId", "currency");
CREATE INDEX IF NOT EXISTS "customer_summaries_accountId_lastSeen_idx"
  ON "customer_summaries"("accountId", "lastSeen");
CREATE INDEX IF NOT EXISTS "customer_summaries_customerName_idx"
  ON "customer_summaries"("customerName");

CREATE TABLE IF NOT EXISTS "duplicate_sc_groups" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "shamCashTxId" TEXT NOT NULL,
  "pairCount" INTEGER NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "duplicate_sc_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "duplicate_sc_groups_accountId_shamCashTxId_key"
  ON "duplicate_sc_groups"("accountId", "shamCashTxId");
CREATE INDEX IF NOT EXISTS "duplicate_sc_groups_lastSeenAt_idx"
  ON "duplicate_sc_groups"("lastSeenAt");
