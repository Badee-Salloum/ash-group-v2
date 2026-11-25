-- Additive, metadata-only on PostgreSQL 11+. No transaction records are changed.
SET lock_timeout = '5s';
ALTER TABLE "duplicate_sc_groups"
  ADD COLUMN IF NOT EXISTS "hasCurrencyMismatch" BOOLEAN NOT NULL DEFAULT FALSE;
RESET lock_timeout;
