import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import {
  lookupCustomerNames,
  lookupCustomerUserIdsByDisplayName,
} from '@/lib/reconciliation/customerNames'
import { requestMetricsHeaders } from '@/lib/performance/cache'
import { createHash } from 'crypto'
import {
  parseCustomerSort, decodeCustomerCursor, encodeCustomerCursor, customerOrderBy,
  customerCursorWhere, customerSearchWhere, CustomerQueryError,
} from '@/lib/customers/transactionSort'

export const runtime = 'nodejs'

const ALLOWED_LIMITS = new Set([25, 50, 100])
const LIST_HEADERS = { 'Cache-Control': 'private, no-store' }

type CustomerTransaction = {
  id: string
  accountId: string
  type: string
  status: string
  source: string
  amount: unknown
  currency: string
  txDateTime: Date
  shamCashTxId: string | null
  platformTxId: string | null
  platformUserId: string | null
  amountDiff: unknown | null
  notes: string | null
  matchedTxId: string | null
  reviewCategory: string | null
  reviewNotes: string | null
  customerName: string | null
  account: { name: string }
  batch: { id: string; batchDate: Date | null; createdAt: Date; uploader: { name: string } | null } | null
}
type SummaryGroup = {
  currency: string
  type: string
  status: string
  _count: { _all: number }
  _sum: { amount: unknown | null }
}

function toNumber(value: unknown): number {
  return Number(value || 0)
}

function summarize(groups: SummaryGroup[]) {
  const depositSum: Record<string, number> = {}
  const withdrawalSum: Record<string, number> = {}
  let depositCount = 0
  let withdrawalCount = 0
  let matchedCount = 0
  let pendingCount = 0
  let discrepancyCount = 0

  for (const group of groups) {
    const count = Number(group._count._all || 0)
    const amount = toNumber(group._sum.amount)
    if (group.type === 'DEPOSIT') {
      depositCount += count
      depositSum[group.currency] = (depositSum[group.currency] || 0) + amount
    } else if (group.type === 'WITHDRAWAL') {
      withdrawalCount += count
      withdrawalSum[group.currency] = (withdrawalSum[group.currency] || 0) + amount
    }
    if (group.status === 'MATCHED') matchedCount += count
    if (group.status === 'PENDING_SC' || group.status === 'PENDING_P') pendingCount += count
    if (group.status === 'DISCREPANCY') discrepancyCount += count
  }

  const balance = Object.fromEntries(
    Array.from(new Set([...Object.keys(depositSum), ...Object.keys(withdrawalSum)])).map(currency => [
      currency,
      (depositSum[currency] || 0) - (withdrawalSum[currency] || 0),
    ]),
  )
  const totalOps = depositCount + withdrawalCount
  return {
    depositCount,
    depositSum,
    withdrawalCount,
    withdrawalSum,
    balance,
    matchedCount,
    pendingCount,
    discrepancyCount,
    totalOps,
    trustScore: totalOps > 0
      ? Math.max(0, Math.round((matchedCount / totalOps) * 100 - (discrepancyCount / totalOps) * 20))
      : 0,
  }
}

const transactionSelect = {
  id: true,
  accountId: true,
  type: true,
  status: true,
  source: true,
  amount: true,
  currency: true,
  txDateTime: true,
  shamCashTxId: true,
  platformTxId: true,
  platformUserId: true,
  amountDiff: true,
  notes: true,
  matchedTxId: true,
  reviewCategory: true,
  reviewNotes: true,
  customerName: true,
  account: { select: { name: true } },
  batch: {
    select: {
      id: true,
      batchDate: true,
      createdAt: true,
      uploader: { select: { name: true } },
    },
  },
} as const

async function allowedAccountScope(userId: string, role: string): Promise<string[] | null> {
  if (role !== UserRole.ACCOUNT_MGR) return null
  const access = await db.accountAccess.findMany({
    where: { userId },
    select: { accountId: true },
  }) as Array<{ accountId: string }>
  return access.map(item => item.accountId)
}

function serializeRow(row: CustomerTransaction) {
  return {
    id: row.id,
    accountId: row.accountId,
    accountLabel: row.account.name,
    type: row.type,
    status: row.status,
    source: row.source,
    amount: toNumber(row.amount),
    currency: row.currency,
    txDateTime: row.txDateTime.toISOString(),
    shamCashTxId: row.shamCashTxId,
    platformTxId: row.platformTxId,
    platformUserId: row.platformUserId,
    amountDiff: row.amountDiff == null ? null : toNumber(row.amountDiff),
    notes: row.notes,
    matchedTxId: row.matchedTxId,
    reviewCategory: row.reviewCategory,
    reviewNotes: row.reviewNotes,
    customerName: row.customerName,
    batch: row.batch ? {
      id: row.batch.id,
      batchDate: row.batch.batchDate?.toISOString() ?? null,
      createdAt: row.batch.createdAt.toISOString(),
      uploaderName: row.batch.uploader?.name ?? null,
    } : null,
  }
}

/**
 * Cursor-paginated customer transaction drill-down. Lists only display fields;
 * raw import JSON remains available exclusively from /api/transactions/[id].
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { name: string } },
) {
  const startedAt = performance.now()
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401, headers: LIST_HEADERS })
    if (session.role === UserRole.EMPLOYEE) {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403, headers: LIST_HEADERS })
    }

    const name = decodeURIComponent(params.name || '').trim()
    if (!name || name.length > 300) {
      return NextResponse.json({ error: 'اسم العميل غير صالح' }, { status: 400, headers: LIST_HEADERS })
    }

    const requestedLimit = Number(req.nextUrl.searchParams.get('limit') || 50)
    const limit = ALLOWED_LIMITS.has(requestedLimit) ? requestedLimit : 50
    const cursorValue = req.nextUrl.searchParams.get('cursor')
    const sort = parseCustomerSort(req.nextUrl.searchParams)
    const search = (req.nextUrl.searchParams.get('search') || '').trim()
    if (search.length > 160) throw new CustomerQueryError('نص البحث طويل جداً')
    const hideMatched = req.nextUrl.searchParams.get('hideMatched') === 'true'
    const cursorScope = createHash('sha256').update(JSON.stringify([name, session.userId, search, hideMatched])).digest('hex')
    const cursor = decodeCustomerCursor(cursorValue, sort, cursorScope)

    const allowedAccountIds = await allowedAccountScope(session.userId, session.role)
    if (allowedAccountIds?.length === 0) {
      return NextResponse.json({
        success: true,
        name,
        data: [],
        pageInfo: { limit, nextCursor: null, hasNext: false, total: 0 },
        summary: summarize([]),
        meta: { matchedByName: 0, matchedByUserId: 0, total: 0, userIds: [] },
        generatedAt: new Date().toISOString(),
      }, { headers: requestMetricsHeaders(startedAt, { queryCount: 1, rowCount: 0 }) })
    }

    const accountScope: Prisma.TransactionWhereInput = allowedAccountIds
      ? { accountId: { in: allowedAccountIds } }
      : {}
    const directUserId = /^USER-(.+)$/.exec(name)?.[1]?.trim() || null
    let redirectName: string | null = null
    let linkedUserIds: string[] = []

    if (directUserId) {
      if (directUserId.length > 191) {
        return NextResponse.json({ error: 'USER ID غير صالح' }, { status: 400, headers: LIST_HEADERS })
      }
      const canonical = await lookupCustomerNames([directUserId])
      redirectName = canonical.get(directUserId) || null
      linkedUserIds = [directUserId]
    } else {
      const [canonicalIds, normalizedRows] = await Promise.all([
        lookupCustomerUserIdsByDisplayName(name),
        db.transaction.findMany({
          where: {
            AND: [accountScope, { customerName: name, platformUserId: { not: null } }],
          },
          distinct: ['platformUserId'],
          select: { platformUserId: true },
          take: 500,
        }),
      ])
      linkedUserIds = Array.from(new Set([
        ...canonicalIds,
        ...normalizedRows
          .map((row: { platformUserId: string | null }) => row.platformUserId)
          .filter((value: string | null): value is string => Boolean(value)),
      ])).slice(0, 500)
    }

    const identityFilter: Prisma.TransactionWhereInput = directUserId
      ? { platformUserId: directUserId }
      : {
        OR: [
          { customerName: name },
          ...(linkedUserIds.length > 0 ? [{ platformUserId: { in: linkedUserIds } }] : []),
        ],
      }
    const baseWhere: Prisma.TransactionWhereInput = {
      AND: [
        accountScope,
        identityFilter,
        // A matched platform row is the mirror of its ShamCash row and would
        // otherwise duplicate the same customer operation in this view.
        { NOT: { AND: [{ status: 'MATCHED' }, { source: 'PLATFORM' }] } },
      ],
    }
    const filteredWhere: Prisma.TransactionWhereInput = { AND: [
      baseWhere, customerSearchWhere(search),
      ...(hideMatched ? [{ OR: [{ status: { not: 'MATCHED' as const } }, { reviewCategory: 'INTERNAL_TRANSFER' as const }] }] : []),
    ] }
    const pageWhere: Prisma.TransactionWhereInput = { AND: [filteredWhere, customerCursorWhere(cursor, sort)] }

    const [total, requestedRows, summaryGroups] = await Promise.all([
      db.transaction.count({ where: filteredWhere }),
      db.transaction.findMany({
        where: pageWhere,
        select: transactionSelect,
        orderBy: customerOrderBy(sort),
        take: limit + 1,
      }),
      db.transaction.groupBy({
        by: ['currency', 'type', 'status'],
        where: baseWhere,
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ])
    const typedRows = requestedRows as unknown as CustomerTransaction[]
    const page = typedRows.slice(0, limit)
    const hasNext = typedRows.length > limit
    const visibleUserIds = Array.from(new Set(page
      .map(row => row.platformUserId)
      .filter((value): value is string => Boolean(value))))
    const serialized = page.map(serializeRow)

    return NextResponse.json({
      success: true,
      name,
      ...(redirectName && redirectName !== name ? { redirectName } : {}),
      data: serialized,
      pageInfo: {
        limit,
        nextCursor: hasNext && page.length > 0
          ? encodeCustomerCursor(page[page.length - 1] as unknown as Record<string, unknown>, sort, cursorScope) : null,
        hasNext,
        total,
      },
      summary: summarize(summaryGroups as unknown as SummaryGroup[]),
      // Keep the old `meta` envelope for clients released before cursor paging.
      meta: {
        matchedByName: directUserId ? 0 : total,
        matchedByUserId: directUserId ? total : Math.max(0, total - page.filter(row => row.customerName === name).length),
        total,
        userIds: visibleUserIds,
      },
      generatedAt: new Date().toISOString(),
    }, {
      headers: requestMetricsHeaders(startedAt, {
        queryCount: 4 + (session.role === UserRole.ACCOUNT_MGR ? 1 : 0),
        rowCount: serialized.length,
      }),
    })
  } catch (error) {
    if (error instanceof CustomerQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: LIST_HEADERS })
    }
    return NextResponse.json({ error: String(error) }, { status: 500, headers: LIST_HEADERS })
  }
}
