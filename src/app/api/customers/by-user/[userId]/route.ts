import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { lookupCustomerNames } from '@/lib/reconciliation/customerNames'

type NameCandidate = { name: string | null; count: number | bigint }

/**
 * Resolve a platform user id to a customer name. This is intentionally a
 * small, normalized lookup: old versions grouped JSON `rawData` and could
 * force a large scan on every redirect.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { userId: string } },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    if (session.role === UserRole.EMPLOYEE) {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
    }

    const userId = decodeURIComponent(params.userId).trim()
    if (!userId || userId.length > 191) {
      return NextResponse.json({ error: 'userId مطلوب' }, { status: 400 })
    }

    const canonical = await lookupCustomerNames([userId])
    const canonicalName = canonical.get(userId)
    if (canonicalName) {
      return NextResponse.json({ success: true, name: canonicalName, source: 'canonical' })
    }

    let allowedAccountIds: string[] | null = null
    if (session.role === UserRole.ACCOUNT_MGR) {
      const access = await db.accountAccess.findMany({
        where: { userId: session.userId },
        select: { accountId: true },
      }) as Array<{ accountId: string }>
      allowedAccountIds = access.map(item => item.accountId)
    }

    if (allowedAccountIds?.length === 0) {
      return NextResponse.json({ success: true, name: `USER-${userId}`, fallback: true })
    }

    const rows = await db.$queryRawUnsafe(
      `SELECT t."customerName" AS name, COUNT(*) AS count
       FROM "transactions" t
       WHERE t."platformUserId" = $1
         AND t."customerName" IS NOT NULL
         AND t."customerName" <> ''
         ${allowedAccountIds ? 'AND t."accountId" = ANY($2::text[])' : ''}
       GROUP BY t."customerName"
       ORDER BY count DESC, name ASC
       LIMIT 10`,
      ...(allowedAccountIds ? [userId, allowedAccountIds] : [userId]),
    ) as NameCandidate[]

    const top = rows.find(row => row.name?.trim())
    if (top?.name) {
      return NextResponse.json({
        success: true,
        name: top.name,
        source: 'transaction-customerName',
        allCandidates: rows.map(row => ({ name: row.name, count: Number(row.count) })),
      })
    }

    return NextResponse.json({
      success: true,
      name: `USER-${userId}`,
      fallback: true,
      message: 'لا يوجد اسم عميل منظم مرتبط بهذا الـ USER ID بعد.',
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
