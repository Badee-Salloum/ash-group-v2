// Canonical customer-name resolution. Names are written while records are
// imported/linked, then read cheaply by customer routes. Historical work is
// performed by the explicit release backfill/admin job, never by a request.
import { db } from '@/lib/db/client'

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
 * Persist names discovered while a bounded import/link operation is already
 * handling the relevant records. Manual entries always win over AUTO values.
 */
export async function upsertCustomerNamesFromBatch(
  records: ReadonlyArray<RecordLite>,
): Promise<{ upserted: number }> {
  const candidates = new Map<string, string>()
  for (const record of records) {
    if (record.status !== 'MATCHED' || record.notes === 'internal-transfer') continue
    const userId = record.platformUserId?.trim()
    if (!userId) continue

    const raw = record.rawData as Record<string, unknown> | null
    if (!raw) continue
    const nestedSc = raw.sc as Record<string, unknown> | undefined
    const name = (
      (typeof raw.accountName === 'string' ? raw.accountName : '') ||
      (nestedSc && typeof nestedSc.accountName === 'string' ? nestedSc.accountName : '')
    ).trim()
    if (name && !candidates.has(userId)) candidates.set(userId, name)
  }

  if (candidates.size === 0 || !(await ensureCustomerTable())) return { upserted: 0 }

  try {
    const platformUserIds = Array.from(candidates.keys())
    const displayNames = platformUserIds.map(id => candidates.get(id)!)
    // One set-based write replaces a find + upsert loop for every customer in
    // an import batch. The WHERE keeps a human-set MANUAL display name intact.
    const upserted = await db.$executeRawUnsafe(`
      INSERT INTO "customers" ("platformUserId", "displayName", "source", "updatedAt", "createdAt")
      SELECT incoming."platformUserId", incoming."displayName", 'AUTO', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM unnest($1::text[], $2::text[]) AS incoming("platformUserId", "displayName")
      ON CONFLICT ("platformUserId") DO UPDATE SET
        "displayName" = EXCLUDED."displayName",
        "source" = 'AUTO',
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "customers"."source" <> 'MANUAL'
        AND (
          "customers"."displayName" IS DISTINCT FROM EXCLUDED."displayName"
          OR "customers"."source" IS DISTINCT FROM 'AUTO'
        )
    `, platformUserIds, displayNames)
    return { upserted: Number(upserted || 0) }
  } catch {
    // A name projection must never fail the reconciliation write path.
    return { upserted: 0 }
  }
}

export async function upsertOneCustomerName(
  platformUserId: string,
  displayName: string,
  source: 'AUTO' | 'MANUAL' = 'AUTO',
  updatedBy?: string,
): Promise<void> {
  const userId = platformUserId.trim()
  const name = displayName.trim()
  if (!userId || !name || !(await ensureCustomerTable())) return

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (db as any).customer.findUnique({
      where: { platformUserId: userId },
      select: { source: true, displayName: true },
    })
    if (existing?.source === 'MANUAL' && source === 'AUTO') return
    if (existing?.displayName === name && existing?.source === source) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).customer.upsert({
      where: { platformUserId: userId },
      create: { platformUserId: userId, displayName: name, source, updatedBy },
      update: { displayName: name, source, updatedBy },
    })
  } catch {
    // Canonical names are an auxiliary projection; callers retain their
    // normalized transaction fallback when it is unavailable.
  }
}

/** Lightweight canonical lookup; it intentionally never starts a backfill. */
export async function lookupCustomerNames(
  userIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = Array.from(new Set(userIds.map(id => id.trim()).filter(Boolean)))
  if (ids.length === 0) return out

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (db as any).customer.findMany({
      where: { platformUserId: { in: ids } },
      select: { platformUserId: true, displayName: true },
    }) as Array<{ platformUserId: string; displayName: string }>
    tableReady = true
    for (const row of rows) out.set(row.platformUserId, row.displayName)
  } catch {
    // Missing/pre-migration projection simply behaves like an empty map.
  }
  return out
}

/**
 * Resolve the bounded set of platform identities explicitly assigned to a
 * canonical display name. The caller still applies account scope to rows.
 */
export async function lookupCustomerUserIdsByDisplayName(
  displayName: string,
  limit = 500,
): Promise<string[]> {
  const name = displayName.trim()
  if (!name) return []

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (db as any).customer.findMany({
      where: { displayName: name },
      select: { platformUserId: true },
      take: Math.max(1, Math.min(limit, 500)),
    }) as Array<{ platformUserId: string }>
    tableReady = true
    return rows.map(row => row.platformUserId).filter(Boolean)
  } catch {
    return []
  }
}
