import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { lookupCustomerNames, upsertOneCustomerName, backfillAllMatchedNamesOnce } from '@/lib/reconciliation/customerNames'

export async function GET(
  req: NextRequest,
  { params }: { params: { name: string } }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const name = decodeURIComponent(params.name).trim()
    if (!name) return NextResponse.json({ error: 'الاسم مطلوب' }, { status: 400 })

    let allowedAccountIds: string[] | null = null
    if (session.role === UserRole.ACCOUNT_MGR) {
      const access = await db.accountAccess.findMany({ where: { userId: session.userId } })
      allowedAccountIds = access.map((a: { accountId: string }) => a.accountId)
    }

    // Hide the platform side of MATCHED pairs (they duplicate the SC side).
    // Same rule the reconciliation API uses.
    const hidePlatformMatched = `
      AND NOT (t.status = 'MATCHED' AND t.source = 'PLATFORM')
    `

    // Special form: "USER-<id>" — the caller couldn't resolve the customer name
    // from rawData (all rows are platform-only with no SC matches), so we treat
    // the id as the primary key and skip step 1 entirely.
    const userIdDirect = /^USER-(.+)$/.exec(name)?.[1]
    if (userIdDirect) {
      // Kick off background backfill on this serverless cold start (one-time
      // per process). For *this* request, also do an inline rawData scan so
      // the redirect happens immediately on the very first visit — without
      // waiting for the background job to finish.
      void backfillAllMatchedNamesOnce()

      let canonicalName: string | undefined
      // 1) Canonical lookup — fastest, hits when prior request already wrote
      //    the name (backfill or another client).
      const canonical = await lookupCustomerNames([userIdDirect])
      canonicalName = canonical.get(userIdDirect)

      // 2) Inline rawData fallback — same query the /by-user route runs.
      //    Guarantees the very first visit to /customers/USER-<id> resolves
      //    the name (and persists it to canonical for subsequent visits).
      if (!canonicalName) {
        try {
          const candidates = (await db.$queryRawUnsafe(
            `SELECT
               COALESCE(
                 NULLIF(t."rawData"->>'accountName', ''),
                 NULLIF(t."rawData"->'sc'->>'accountName', ''),
                 NULLIF(mt."rawData"->>'accountName', ''),
                 NULLIF(mt."rawData"->'sc'->>'accountName', '')
               ) AS name,
               COUNT(*) AS c
             FROM "transactions" t
             LEFT JOIN "transactions" mt ON mt.id = t."matchedTxId"
             WHERE t."platformUserId" = $1
             GROUP BY name
             ORDER BY c DESC
             LIMIT 10`,
            userIdDirect,
          )) as Array<{ name: string | null; c: number | bigint }>
          const top = candidates.find(r => r.name && String(r.name).trim())
          if (top?.name) {
            canonicalName = String(top.name).trim()
            // Persist for future hits — fire-and-forget.
            upsertOneCustomerName(userIdDirect, canonicalName, 'AUTO').catch(() => {})
          }
        } catch {
          // Silent — fall through with userIdDirect-based listing.
        }
      }
      const sql = `
        SELECT t.id, t."accountId", t.type, t.status, t.source, t.amount, t.currency,
               t."txDateTime", t."shamCashTxId", t."platformTxId", t."platformUserId",
               t."amountDiff", t.notes, t."rawData", t."matchedTxId",
               t."reviewCategory", t."reviewNotes", a.name AS "accountLabel"
        FROM "transactions" t
        LEFT JOIN "accounts" a ON a.id = t."accountId"
        WHERE t."platformUserId" = $1
        ${hidePlatformMatched}
        ${allowedAccountIds ? `AND t."accountId" = ANY($2::text[])` : ''}
        ORDER BY t."txDateTime" DESC
        LIMIT 5000
      `
      const args = allowedAccountIds ? [userIdDirect, allowedAccountIds] : [userIdDirect]
      const result = (await db.$queryRawUnsafe(sql, ...args)) as Array<Record<string, unknown>>
      return NextResponse.json({
        success: true,
        name,
        data: result,
        // If we now know the real name, expose it for client-side redirect.
        ...(canonicalName ? { redirectName: canonicalName } : {}),
        meta: { matchedByName: 0, matchedByUserId: result.length, total: result.length, userIds: [userIdDirect] },
      })
    }

    // Step 1: Find all transactions matching the customer name in rawData.
    // Hide platform side of MATCHED pairs (duplicates the SC side).
    const byNameSql = `
      SELECT t.id, t."accountId", t.type, t.status, t.source, t.amount, t.currency,
             t."txDateTime", t."shamCashTxId", t."platformTxId", t."platformUserId",
             t."amountDiff", t.notes, t."rawData", t."matchedTxId",
             t."reviewCategory", t."reviewNotes", a.name AS "accountLabel"
      FROM "transactions" t
      LEFT JOIN "accounts" a ON a.id = t."accountId"
      WHERE (
        t."rawData"->>'accountName' = $1
        OR t."rawData"->'sc'->>'accountName' = $1
      )
      ${hidePlatformMatched}
      ${allowedAccountIds ? `AND t."accountId" = ANY($2::text[])` : ''}
      ORDER BY t."txDateTime" DESC
      LIMIT 5000
    `
    const byNameArgs = allowedAccountIds ? [name, allowedAccountIds] : [name]
    const byName = (await db.$queryRawUnsafe(byNameSql, ...byNameArgs)) as Array<Record<string, unknown>>

    // Step 2: Collect distinct platformUserIds from the name-matched rows.
    // Any other transaction that shares one of these User IDs belongs to the
    // same customer on the platform — even if accountName differs.
    const userIds = Array.from(
      new Set(
        byName
          .map(r => r.platformUserId)
          .filter((x): x is string => typeof x === 'string' && x.length > 0)
      )
    )

    // Step 3: Fetch all transactions with matching platformUserId (excluding
    // the ones we already have from step 1 to avoid duplicates).
    let byUser: Array<Record<string, unknown>> = []
    if (userIds.length > 0) {
      const existingIds = new Set(byName.map(r => r.id as string))
      const byUserSql = `
        SELECT t.id, t."accountId", t.type, t.status, t.source, t.amount, t.currency,
               t."txDateTime", t."shamCashTxId", t."platformTxId", t."platformUserId",
               t."amountDiff", t.notes, t."rawData", t."matchedTxId",
               t."reviewCategory", t."reviewNotes", a.name AS "accountLabel"
        FROM "transactions" t
        LEFT JOIN "accounts" a ON a.id = t."accountId"
        WHERE t."platformUserId" = ANY($1::text[])
        ${hidePlatformMatched}
        ${allowedAccountIds ? `AND t."accountId" = ANY($2::text[])` : ''}
        ORDER BY t."txDateTime" DESC
        LIMIT 5000
      `
      const byUserArgs = allowedAccountIds ? [userIds, allowedAccountIds] : [userIds]
      const all = (await db.$queryRawUnsafe(byUserSql, ...byUserArgs)) as Array<Record<string, unknown>>
      byUser = all.filter(r => !existingIds.has(r.id as string))
    }

    // Step 4: Merge + sort by txDateTime DESC
    const merged = [...byName, ...byUser].sort((a, b) => {
      const ta = new Date(String(a.txDateTime)).getTime()
      const tb = new Date(String(b.txDateTime)).getTime()
      return tb - ta
    })

    return NextResponse.json({
      success: true,
      name,
      data: merged,
      meta: {
        matchedByName: byName.length,
        matchedByUserId: byUser.length,
        total: merged.length,
        userIds,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
