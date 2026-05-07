import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { lookupCustomerNames, upsertOneCustomerName } from '@/lib/reconciliation/customerNames'

// Given a platformUserId, return the best-guess customer name (most common
// accountName across the user's transactions). Used by the /customers/by-user/
// redirect page to jump from the reconciliation page straight to the customer
// profile.
export async function GET(
  req: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const userId = decodeURIComponent(params.userId).trim()
    if (!userId) return NextResponse.json({ error: 'userId مطلوب' }, { status: 400 })

    // ── 1. Canonical lookup first (Customer table) ──
    // This is the source of truth — populated automatically the moment a
    // transaction reaches MATCHED status with an accountName, and editable
    // by admins. Skips the rawData scan entirely on hit.
    const canonical = await lookupCustomerNames([userId])
    const canonicalName = canonical.get(userId)
    if (canonicalName) {
      return NextResponse.json({ success: true, name: canonicalName, source: 'canonical' })
    }

    let allowedAccountIds: string[] | null = null
    if (session.role === UserRole.ACCOUNT_MGR) {
      const access = await db.accountAccess.findMany({ where: { userId: session.userId } })
      allowedAccountIds = access.map((a: { accountId: string }) => a.accountId)
    }

    // ── 2. Fallback rawData scan (legacy data without canonical name) ──
    // Find all transactions for this userId. Look for accountName in the row's
    // own rawData, and also in the MATCHED counterpart's rawData — because for
    // platform-only rows the customer name lives on the SC side.
    const rows = (await db.$queryRawUnsafe(
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
         ${allowedAccountIds ? `AND t."accountId" = ANY($2::text[])` : ''}
       GROUP BY name
       ORDER BY c DESC
       LIMIT 10`,
      ...(allowedAccountIds ? [userId, allowedAccountIds] : [userId])
    )) as Array<{ name: string | null; c: number | bigint }>

    const top = rows.find(r => r.name && String(r.name).trim())
    if (top && top.name) {
      // Lazy backfill: persist this resolution so the next lookup hits the
      // canonical table directly. Fire-and-forget — never blocks the response.
      upsertOneCustomerName(userId, String(top.name).trim(), 'AUTO').catch(() => {})
      return NextResponse.json({ success: true, name: top.name, allCandidates: rows })
    }

    // No accountName found — maybe all the user's transactions are platform-only
    // with no matched SC side. Return a synthetic fallback that the redirect
    // page will use to show a user-id-based profile.
    return NextResponse.json({
      success: true,
      name: `USER-${userId}`,
      fallback: true,
      message: 'لا يوجد اسم عميل مرتبط بهذا الـ USER ID — سيُعرَض السجل عبر الرقم مباشرة.',
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
