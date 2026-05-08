import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

// GET /api/follow-ups/stats
// Returns counts for the follow-up dashboard widgets.
// "stale" = OPEN with reviewedAt older than 7 days.
// Privileged roles see global numbers; everyone sees their own assigned numbers.
const VIEW_ALL_ROLES: string[] = [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.ACCOUNT_MGR, 'ACCOUNTANT']

const STALE_DAYS = 7

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 })

    const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000)
    const customerFacing = ['COMPLAINT', 'CUSTOMER_ERROR', 'PLATFORM_ERROR']
    const canViewAll = VIEW_ALL_ROLES.includes(session.role)

    // Account scope for ACCOUNT_MGR
    let accountFilter: Record<string, unknown> = {}
    if (session.role === UserRole.ACCOUNT_MGR) {
      const access = await db.accountAccess.findMany({ where: { userId: session.userId } })
      const allowedIds = access.map((a: { accountId: string }) => a.accountId)
      accountFilter = { accountId: { in: allowedIds } }
    }

    const baseGlobal = {
      ...accountFilter,
      reviewCategory: { in: customerFacing },
    }

    const baseMine = {
      ...accountFilter,
      reviewCategory: { in: customerFacing },
      followUpAssignedTo: session.userId,
    }

    const [
      globalOpen, globalInProgress, globalStale,
      mineOpen, mineInProgress, mineStale,
    ] = await Promise.all([
      canViewAll ? db.transaction.count({ where: { ...baseGlobal, followUpStatus: 'OPEN' } }) : Promise.resolve(0),
      canViewAll ? db.transaction.count({ where: { ...baseGlobal, followUpStatus: 'IN_PROGRESS' } }) : Promise.resolve(0),
      canViewAll ? db.transaction.count({
        where: { ...baseGlobal, followUpStatus: 'OPEN', reviewedAt: { lt: staleCutoff } },
      }) : Promise.resolve(0),
      db.transaction.count({ where: { ...baseMine, followUpStatus: 'OPEN' } }),
      db.transaction.count({ where: { ...baseMine, followUpStatus: 'IN_PROGRESS' } }),
      db.transaction.count({
        where: { ...baseMine, followUpStatus: 'OPEN', reviewedAt: { lt: staleCutoff } },
      }),
    ])

    return NextResponse.json({
      success: true,
      data: {
        canViewAll,
        global: canViewAll
          ? { open: globalOpen, inProgress: globalInProgress, stale: globalStale }
          : null,
        mine: { open: mineOpen, inProgress: mineInProgress, stale: mineStale },
        staleDays: STALE_DAYS,
      },
    })
  } catch (e) {
    console.error('GET /api/follow-ups/stats error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ success: false, error: 'خطأ في الخادم' }, { status: 500 })
  }
}
