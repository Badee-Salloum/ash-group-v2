import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import {
  decodeDuplicateGroupCursor,
  encodeDuplicateGroupCursor,
  InvalidDuplicateGroupCursorError,
  parseDuplicateGroupQuery,
} from '@/lib/reconciliation/duplicateGroups'
import { estimateJsonBytes, requestMetricsHeaders } from '@/lib/performance/cache'
import { z } from 'zod'

export const runtime = 'nodejs'

const LIST_HEADERS = { 'Cache-Control': 'private, no-store' }

type DuplicateGroupRecord = {
  id: string
  accountId: string
  shamCashTxId: string
  pairCount: number
  hasCurrencyMismatch: boolean
  lastSeenAt: Date | string
  refreshedAt: Date | string
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString()
}

/**
 * Account managers can only inspect group rows for accounts explicitly
 * assigned to them.  We return an empty `in` list for a denied requested id
 * rather than silently broadening the query to all of their accounts.
 */
async function duplicateGroupScope(
  userId: string,
  role: string,
  requestedAccountId?: string,
): Promise<Record<string, unknown>> {
  if (role !== UserRole.ACCOUNT_MGR) {
    return requestedAccountId ? { accountId: requestedAccountId } : {}
  }

  const access = await db.accountAccess.findMany({
    where: { userId },
    select: { accountId: true },
  }) as Array<{ accountId: string }>
  const accountIds = access.map(row => row.accountId)
  if (requestedAccountId) {
    return accountIds.includes(requestedAccountId)
      ? { accountId: requestedAccountId }
      : { accountId: { in: [] } }
  }
  return { accountId: { in: accountIds } }
}

export async function GET(req: NextRequest) {
  const startedAt = performance.now()
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401, headers: LIST_HEADERS })
    if (session.role === UserRole.EMPLOYEE) {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403, headers: LIST_HEADERS })
    }

    const query = parseDuplicateGroupQuery(new URL(req.url).searchParams)
    const dbStartedAt = performance.now()
    const scope = await duplicateGroupScope(session.userId, session.role, query.accountId)
    const baseWhere = {
      OR: [{ pairCount: { gt: 1 } }, { hasCurrencyMismatch: true }],
      ...scope,
    }
    const cursor = query.cursor ? decodeDuplicateGroupCursor(query.cursor) : undefined
    const pageWhere = cursor
      ? {
          AND: [
            baseWhere,
            {
              OR: [
                { lastSeenAt: { lt: new Date(cursor.lastSeenAt) } },
                { lastSeenAt: new Date(cursor.lastSeenAt), id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : baseWhere

    const [total, requestedRows] = await Promise.all([
      db.duplicateScGroup.count({ where: baseWhere }),
      db.duplicateScGroup.findMany({
        where: pageWhere,
        select: {
          id: true,
          accountId: true,
          shamCashTxId: true,
          pairCount: true,
          hasCurrencyMismatch: true,
          lastSeenAt: true,
          refreshedAt: true,
        },
        orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
    ]) as [number, DuplicateGroupRecord[]]

    const hasNext = requestedRows.length > query.limit
    const rows = requestedRows.slice(0, query.limit)
    const last = rows.at(-1)
    const nextCursor = hasNext && last
      ? encodeDuplicateGroupCursor({ id: last.id, lastSeenAt: iso(last.lastSeenAt) })
      : null

    const payload = {
      success: true,
      data: rows.map(row => ({
        id: row.id,
        accountId: row.accountId,
        shamCashTxId: row.shamCashTxId,
        pairCount: row.pairCount,
        hasDuplicateSc: row.pairCount > 1,
        hasCurrencyMismatch: row.hasCurrencyMismatch,
        lastSeenAt: iso(row.lastSeenAt),
        refreshedAt: iso(row.refreshedAt),
      })),
      pageInfo: { limit: query.limit, nextCursor, hasNext, total },
      generatedAt: new Date().toISOString(),
    }
    return NextResponse.json(payload, {
      headers: requestMetricsHeaders(startedAt, {
        dbMs: performance.now() - dbStartedAt,
        queryCount: 2 + (session.role === UserRole.ACCOUNT_MGR ? 1 : 0),
        rowCount: rows.length,
        responseBytes: estimateJsonBytes(payload),
      }),
    })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof InvalidDuplicateGroupCursorError) {
      return NextResponse.json({ error: error.message || 'طلب التكرارات غير صالح' }, { status: 400, headers: LIST_HEADERS })
    }
    return NextResponse.json({ error: String(error) }, { status: 500, headers: LIST_HEADERS })
  }
}
