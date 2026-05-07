// Customer name resolution. Triggered immediately after MATCHED records are
// persisted: extract {platformUserId, accountName} pairs and upsert into the
// Customer table. AUTO entries never overwrite MANUAL ones (admin overrides
// take priority).
//
// Self-heals: ensures the `customers` table exists before any write — if a
// deploy lands on a database that hasn't been migrated yet, the first call
// creates the table inline. No `prisma db push` needed for this feature.
import { db } from '@/lib/db/client'

// Tracks whether ensureCustomerTable has succeeded this process. Avoids
// hammering the DB with CREATE-IF-NOT-EXISTS on every single upsert.
let tableReady = false

async function ensureCustomerTable(): Promise<boolean> {
  if (tableReady) return true
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "customers" (
        "platformUserId" TEXT PRIMARY KEY,
        "displayName"    TEXT NOT NULL,
        "source"         TEXT NOT NULL DEFAULT 'AUTO',
        "updatedBy"      TEXT,
        "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    tableReady = true
    return true
  } catch {
    return false
  }
}

interface RecordLite {
  source: string
  status: string
  platformUserId?: string | null
  rawData?: unknown
  notes?: string | null
}

/**
 * Walk MATCHED records, pull SC-side accountName + platformUserId pairs,
 * upsert into Customer table. Skips entries with missing fields and never
 * overwrites manual overrides.
 *
 * Safe to call defensively — if the customers table is missing (pre-DB-push)
 * the whole call is a no-op rather than throwing.
 */
export async function upsertCustomerNamesFromBatch(
  records: ReadonlyArray<RecordLite>,
): Promise<{ upserted: number }> {
  // Collect candidate pairs. Prefer SC-side rows (rawData has accountName at
  // top level for matched-deposits/withdrawals). Skip internal-transfer rows.
  const candidates = new Map<string, string>()
  for (const r of records) {
    if (r.status !== 'MATCHED') continue
    if (r.notes === 'internal-transfer') continue
    const userId = r.platformUserId?.trim()
    if (!userId) continue
    const raw = r.rawData as Record<string, unknown> | null
    if (!raw) continue
    // Top-level accountName (SC matched stores rawData = pair.shamCash)
    const top = typeof raw.accountName === 'string' ? raw.accountName.trim() : ''
    // Or nested under 'sc' (some discrepancy records)
    const sc = raw.sc as Record<string, unknown> | undefined
    const nested = sc && typeof sc.accountName === 'string' ? sc.accountName.trim() : ''
    const name = top || nested
    if (!name) continue
    // First-write-wins per userId within this batch
    if (!candidates.has(userId)) candidates.set(userId, name)
  }
  if (candidates.size === 0) return { upserted: 0 }

  // Self-heal: ensure table exists before writing (no-op once initialised).
  if (!(await ensureCustomerTable())) return { upserted: 0 }

  let upserted = 0
  try {
    // Don't overwrite MANUAL entries — admins win.
    for (const [platformUserId, displayName] of candidates) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = await (db as any).customer.findUnique({
        where: { platformUserId },
        select: { source: true, displayName: true },
      })
      if (existing && existing.source === 'MANUAL') continue
      if (existing && existing.displayName === displayName) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).customer.upsert({
        where: { platformUserId },
        create: { platformUserId, displayName, source: 'AUTO' },
        update: { displayName, source: 'AUTO' },
      })
      upserted++
    }
  } catch {
    // Table missing or transient DB issue — silent no-op so reconciliation
    // batches don't fail because of name backfill problems.
    return { upserted }
  }
  return { upserted }
}

/**
 * Upsert a single customer name. Used for lazy backfill from the resolver:
 * when the rawData scan yields a name, persist it so subsequent lookups go
 * through the canonical table. Skips if MANUAL entry exists.
 */
export async function upsertOneCustomerName(
  platformUserId: string,
  displayName: string,
  source: 'AUTO' | 'MANUAL' = 'AUTO',
  updatedBy?: string,
): Promise<void> {
  const userId = platformUserId.trim()
  const name = displayName.trim()
  if (!userId || !name) return
  if (!(await ensureCustomerTable())) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (db as any).customer.findUnique({
      where: { platformUserId: userId },
      select: { source: true, displayName: true },
    })
    // MANUAL overrides win — AUTO writes never clobber them.
    if (existing && existing.source === 'MANUAL' && source === 'AUTO') return
    if (existing && existing.displayName === name && existing.source === source) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).customer.upsert({
      where: { platformUserId: userId },
      create: { platformUserId: userId, displayName: name, source, updatedBy },
      update: { displayName: name, source, updatedBy },
    })
  } catch {
    // Table missing or transient — silent.
  }
}

/**
 * Lookup canonical name for a list of platformUserIds. Returns a Map; missing
 * keys mean "no canonical name yet". Defensive against missing table.
 *
 * On first lookup of a fresh deploy, kicks off a one-time background backfill
 * of all historical MATCHED rows so the table fills up without manual action.
 */
export async function lookupCustomerNames(
  userIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  if (ids.length === 0) return out

  // Self-heal: if the table doesn't exist yet, create it now so the rest of
  // the request (and the background backfill) can write to it.
  await ensureCustomerTable()

  // Kick off background backfill the first time we're called (process-wide).
  void backfillAllMatchedNamesOnce()

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (db as any).customer.findMany({
      where: { platformUserId: { in: ids } },
      select: { platformUserId: true, displayName: true },
    })
    for (const r of rows as Array<{ platformUserId: string; displayName: string }>) {
      out.set(r.platformUserId, r.displayName)
    }
  } catch {
    // Table missing — return empty map, callers fall back to rawData scan
  }
  return out
}

// Process-level guard for the once-per-process backfill.
let backfillFired = false
let backfillPromise: Promise<void> | null = null

/**
 * Background backfill of all historical MATCHED SC-side rows into the
 * Customer table. Runs once per process (per serverless cold start). Silent —
 * never throws. Designed to be invoked fire-and-forget.
 *
 * Subsequent runs after a cold start are also fine (idempotent + skips
 * unchanged rows), but we suppress them within a process to limit DB churn.
 */
export async function backfillAllMatchedNamesOnce(): Promise<void> {
  if (backfillFired) return backfillPromise ?? undefined
  backfillFired = true
  backfillPromise = (async () => {
    try {
      if (!(await ensureCustomerTable())) return
      const PAGE = 500
      let cursor: string | undefined
      // Cap total work to avoid runaway loops on huge datasets — keep the
      // serverless invocation budget sensible. Anything beyond will get
      // backfilled lazily via the per-customer resolver path.
      const MAX_PAGES = 20
      for (let i = 0; i < MAX_PAGES; i++) {
        const rows = await db.transaction.findMany({
          where: {
            status: 'MATCHED',
            source: 'SHAM_CASH',
            platformUserId: { not: null },
          },
          select: {
            id: true, source: true, status: true,
            platformUserId: true, rawData: true, notes: true,
          },
          orderBy: { id: 'asc' },
          take: PAGE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        })
        if (rows.length === 0) break
        await upsertCustomerNamesFromBatch(rows as ReadonlyArray<RecordLite>)
        if (rows.length < PAGE) break
        cursor = rows[rows.length - 1].id
      }
    } catch {
      // Background work — never throw out to caller. Reset flag so the next
      // cold start retries.
      backfillFired = false
    }
  })()
  return backfillPromise
}
