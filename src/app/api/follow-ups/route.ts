import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

// GET /api/follow-ups
// Lists transactions with an active follow-up (followUpStatus != null).
// Filters: status, category, assignedTo ('me' | userId), dateFrom, dateTo, search, includeClosed.
// RBAC:
//   ADMIN / SUPERVISOR / ACCOUNT_MGR / ACCOUNTANT → all follow-ups (ACCOUNT_MGR limited to their accounts)
//   anyone else                                  → only their own assigned follow-ups
const VIEW_ALL_ROLES: string[] = [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.ACCOUNT_MGR, 'ACCOUNTANT']

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const page = Math.max(parseInt(searchParams.get('page') || '1'), 1)
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '50'), 1), 200)
    const status = searchParams.get('status') // OPEN | IN_PROGRESS | RESOLVED | CLOSED | ''
    const category = searchParams.get('category') // COMPLAINT | CUSTOMER_ERROR | PLATFORM_ERROR | ''
    const assignedTo = searchParams.get('assignedTo') // 'me' | userId | 'unassigned' | ''
    const search = (searchParams.get('search') || '').trim()
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const includeClosed = searchParams.get('includeClosed') === 'true'

    const canViewAll = VIEW_ALL_ROLES.includes(session.role)

    const where: Record<string, unknown> = {
      // baseline: anything that has a follow-up status
      followUpStatus: { not: null },
    }

    // Default: hide RESOLVED and CLOSED unless explicitly requested or includeClosed is set
    if (status) {
      where.followUpStatus = status
    } else if (!includeClosed) {
      where.followUpStatus = { in: ['OPEN', 'IN_PROGRESS'] }
    }

    if (category) {
      where.reviewCategory = category
    } else {
      // Restrict to the customer-facing trio so this view stays focused
      where.reviewCategory = { in: ['COMPLAINT', 'CUSTOMER_ERROR', 'PLATFORM_ERROR'] }
    }

    if (assignedTo === 'me') {
      where.followUpAssignedTo = session.userId
    } else if (assignedTo === 'unassigned') {
      where.followUpAssignedTo = null
    } else if (assignedTo) {
      where.followUpAssignedTo = assignedTo
    }

    // Non-privileged users only ever see their own assignments
    if (!canViewAll) {
      where.followUpAssignedTo = session.userId
    }

    // ACCOUNT_MGR is restricted to their accounts
    if (session.role === UserRole.ACCOUNT_MGR) {
      const access = await db.accountAccess.findMany({ where: { userId: session.userId } })
      const allowedIds = access.map((a: { accountId: string }) => a.accountId)
      where.accountId = { in: allowedIds }
    }

    if (dateFrom || dateTo) {
      where.txDateTime = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59') } : {}),
      }
    }

    if (search) {
      where.OR = [
        { shamCashTxId: { contains: search, mode: 'insensitive' } },
        { platformTxId: { contains: search, mode: 'insensitive' } },
        { platformUserId: { contains: search, mode: 'insensitive' } },
        { reviewNotes: { contains: search, mode: 'insensitive' } },
        { followUpResolution: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [total, rows, statusCounts] = await Promise.all([
      db.transaction.count({ where }),
      db.transaction.findMany({
        where,
        include: {
          account: { select: { name: true, currency: true } },
          followUpAssignee: { select: { id: true, name: true } },
        },
        // Oldest review first within each status — focuses attention on stale items
        orderBy: [
          { followUpStatus: 'asc' },
          { reviewedAt: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      // Aggregated status counts ignoring the status filter (so the UI can show pill counts)
      db.transaction.groupBy({
        by: ['followUpStatus'],
        where: (() => {
          const w = { ...where }
          delete (w as Record<string, unknown>).followUpStatus
          // re-apply customer-facing baseline
          if (!category) (w as Record<string, unknown>).reviewCategory = { in: ['COMPLAINT', 'CUSTOMER_ERROR', 'PLATFORM_ERROR'] }
          ;(w as Record<string, unknown>).followUpStatus = { not: null }
          return w
        })(),
        _count: { _all: true },
      }),
    ])

    // Resolve reviewedBy and followUpResolvedBy → User.name in a single query
    const userIds = new Set<string>()
    for (const r of rows) {
      if (r.reviewedBy) userIds.add(r.reviewedBy)
      if (r.followUpResolvedBy) userIds.add(r.followUpResolvedBy)
    }
    const users: { id: string; name: string }[] = userIds.size
      ? await db.user.findMany({ where: { id: { in: Array.from(userIds) } }, select: { id: true, name: true } })
      : []
    const userMap = new Map(users.map((u: { id: string; name: string }) => [u.id, u.name]))

    type Row = (typeof rows)[number]
    const data = rows.map((r: Row) => ({
      id: r.id,
      accountId: r.accountId,
      accountName: r.account.name,
      currency: r.account.currency,
      type: r.type,
      source: r.source,
      amount: r.amount.toString(),
      txDateTime: r.txDateTime.toISOString(),
      shamCashTxId: r.shamCashTxId,
      platformTxId: r.platformTxId,
      platformUserId: r.platformUserId,
      reviewCategory: r.reviewCategory,
      reviewNotes: r.reviewNotes,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewedByName: r.reviewedBy ? userMap.get(r.reviewedBy) ?? null : null,
      followUpStatus: r.followUpStatus,
      followUpAssignedTo: r.followUpAssignedTo,
      followUpAssigneeName: r.followUpAssignee?.name ?? null,
      followUpResolution: r.followUpResolution,
      followUpResolvedAt: r.followUpResolvedAt?.toISOString() ?? null,
      followUpResolvedByName: r.followUpResolvedBy ? userMap.get(r.followUpResolvedBy) ?? null : null,
    }))

    const counts = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 } as Record<string, number>
    for (const sc of statusCounts) {
      if (sc.followUpStatus) counts[sc.followUpStatus] = sc._count._all
    }

    // Privileged users get the assignable-users list bundled in the response
    // (saves a second round-trip when the modal opens).
    const assignees = canViewAll
      ? await db.user.findMany({
          where: { isActive: true },
          select: { id: true, name: true, role: true },
          orderBy: { name: 'asc' },
        })
      : []

    return NextResponse.json({
      success: true,
      data,
      counts,
      assignees,
      currentUserId: session.userId,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (e) {
    console.error('GET /api/follow-ups error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ success: false, error: 'خطأ في الخادم' }, { status: 500 })
  }
}
