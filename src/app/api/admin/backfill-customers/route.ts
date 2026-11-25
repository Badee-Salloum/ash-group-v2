import { NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { upsertCustomerNamesFromBatch } from '@/lib/reconciliation/customerNames'

// One-time backfill: scan all MATCHED SC-side rows in the database and
// populate the Customer table. Idempotent — safe to re-run; AUTO entries
// are refreshed, MANUAL overrides are preserved.
//
// POST /api/admin/backfill-customers
// Restricted to ADMIN.
export async function POST() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    // Stream-process to keep memory bounded — chunked through cuid pages.
    const PAGE = 1000
    let cursor: string | undefined
    let totalScanned = 0
    let totalUpserted = 0
    while (true) {
      const rows: Array<{
        id: string
        source: string
        status: string
        platformUserId: string | null
        rawData: unknown
        notes: string | null
      }> = await db.transaction.findMany({
        where: {
          status: 'MATCHED',
          source: 'SHAM_CASH',
          platformUserId: { not: null },
        },
        select: { id: true, source: true, status: true, platformUserId: true, rawData: true, notes: true },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      })
      if (rows.length === 0) break
      totalScanned += rows.length
      const r = await upsertCustomerNamesFromBatch(rows)
      totalUpserted += r.upserted
      if (rows.length < PAGE) break
      cursor = rows[rows.length - 1].id
    }

    await audit(session.userId, 'BACKFILL_CUSTOMERS', 'Customer', undefined, {
      scanned: totalScanned, upserted: totalUpserted,
    })
    return NextResponse.json({
      success: true,
      data: { scanned: totalScanned, upserted: totalUpserted },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
