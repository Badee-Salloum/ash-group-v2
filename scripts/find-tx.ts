import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const SEARCH = '183056457'

async function main() {
  // Direct field match
  const byField = await db.transaction.findMany({
    where: {
      OR: [
        { shamCashTxId: SEARCH },
        { platformTxId: SEARCH },
        { platformUserId: SEARCH },
      ],
    },
    include: { account: { select: { name: true } }, batch: { select: { batchDate: true, createdAt: true } } },
  })

  console.log(`\n=== Direct field match: ${byField.length} row(s) ===`)
  for (const t of byField) {
    console.log({
      id: t.id,
      account: t.account.name,
      type: t.type,
      status: t.status,
      source: t.source,
      amount: String(t.amount),
      currency: t.currency,
      txDateTime: t.txDateTime,
      shamCashTxId: t.shamCashTxId,
      platformTxId: t.platformTxId,
      platformUserId: t.platformUserId,
      matchedTxId: t.matchedTxId,
      notes: t.notes,
      batchDate: t.batch.batchDate,
      createdAt: t.createdAt,
    })
  }

  // Search rawData JSON
  const byRaw = await db.$queryRawUnsafe<any[]>(
    `SELECT id, "accountId", type, status, source, amount, currency, "txDateTime", "shamCashTxId", "platformTxId", "rawData"
     FROM "transactions"
     WHERE "rawData"::text ILIKE $1
     LIMIT 20`,
    `%${SEARCH}%`
  )
  console.log(`\n=== rawData JSON match: ${byRaw.length} row(s) ===`)
  for (const r of byRaw) {
    console.log({
      id: r.id,
      type: r.type,
      status: r.status,
      source: r.source,
      amount: String(r.amount),
      currency: r.currency,
      txDateTime: r.txDateTime,
      shamCashTxId: r.shamCashTxId,
      platformTxId: r.platformTxId,
    })
  }

  // Search audit logs for any trace of this ID (deletion proof)
  const audits = await db.auditLog.findMany({
    where: {
      OR: [
        { details: { path: ['id'], string_contains: SEARCH } as any },
        // fallback: text search
      ],
    },
    take: 5,
  }).catch(() => [] as any[])

  const auditsRaw = await db.$queryRawUnsafe<any[]>(
    `SELECT id, action, "entityType", "entityId", "userId", "createdAt", details
     FROM "audit_logs"
     WHERE details::text ILIKE $1 OR "entityId" = $2
     ORDER BY "createdAt" DESC
     LIMIT 20`,
    `%${SEARCH}%`,
    SEARCH
  ).catch(() => [] as any[])

  console.log(`\n=== Audit log hits: ${auditsRaw.length} ===`)
  for (const a of auditsRaw) {
    console.log({
      when: a.createdAt,
      action: a.action,
      entity: `${a.entityType}:${a.entityId}`,
      user: a.userId,
      details: a.details,
    })
  }
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
