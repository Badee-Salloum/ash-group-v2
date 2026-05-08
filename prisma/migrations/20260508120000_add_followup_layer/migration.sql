-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- AlterTable
ALTER TABLE "transactions"
  ADD COLUMN "followUpStatus"     "FollowUpStatus",
  ADD COLUMN "followUpAssignedTo" TEXT,
  ADD COLUMN "followUpResolution" TEXT,
  ADD COLUMN "followUpResolvedAt" TIMESTAMP(3),
  ADD COLUMN "followUpResolvedBy" TEXT;

-- AddForeignKey
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_followUpAssignedTo_fkey"
  FOREIGN KEY ("followUpAssignedTo") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "transactions_followUpStatus_idx" ON "transactions"("followUpStatus");

-- CreateIndex
CREATE INDEX "transactions_followUpAssignedTo_followUpStatus_idx" ON "transactions"("followUpAssignedTo", "followUpStatus");
