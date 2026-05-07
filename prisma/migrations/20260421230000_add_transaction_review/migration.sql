-- CreateEnum
CREATE TYPE "ReviewCategory" AS ENUM ('THEFT', 'WASTE', 'EXTRA', 'EMPLOYEE_ERROR', 'CUSTOMER_ERROR', 'PLATFORM_ERROR', 'OTHER');

-- AlterTable
ALTER TABLE "transactions"
  ADD COLUMN "reviewCategory" "ReviewCategory",
  ADD COLUMN "reviewNotes" TEXT,
  ADD COLUMN "reviewedBy" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "transactions_reviewCategory_idx" ON "transactions"("reviewCategory");
