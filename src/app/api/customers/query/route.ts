import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { CACHE_TAGS, cachedPrivateRead, estimateJsonBytes, requestMetricsHeaders } from '@/lib/performance/cache'
import { addDays, damascusDayStartUtc } from '@/lib/datetime'
import { performanceReadModelsReady } from '@/lib/performance/readiness'
import { createHash } from 'crypto'
import { parseDirectorySort, directorySortExpression, decodeDirectoryCursor, encodeDirectoryCursor, DirectorySortError } from '@/lib/customers/directorySort'

const ALLOWED_LIMITS = new Set([25, 50, 100])

type CustomerRow = {
  name: string
  accountIds: string[]
  accountLabels: string[]
  currencies: string[]
  depositCount: number | bigint
  withdrawalCount: number | bigint
  matchedCount: number | bigint
  pendingCount: number | bigint
  discrepancyCount: number | bigint
  depositSum: unknown
  withdrawalSum: unknown
  firstSeen: Date
  lastSeen: Date
  total: number | bigint
  sortValue?: string | number | Date
}

function asNumberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([currency, amount]) => [currency, Number(amount || 0)]),
  )
}

function parseCalendarDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || !date.toISOString().startsWith(value) ? null : value
}

/**
 * Cursor-paginated customer directory. Without a period filter it reads the
 * additive CustomerSummary read model. Period searches use grouped normalized
 * transaction fields. Only during the explicit expand/backfill window does a
 * legacy JSON-name fallback keep historical results available.
 */
export async function GET(req: NextRequest) {
  const startedAt = performance.now()
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    if (session.role === UserRole.EMPLOYEE) {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
    }

    const params = req.nextUrl.searchParams
    const requestedLimit = Number(params.get('limit') || 50)
    const limit = ALLOWED_LIMITS.has(requestedLimit) ? requestedLimit : 50
    const sort = parseDirectorySort(params)

    const accountId = params.get('accountId') || null
    const currency = params.get('currency') || null
    const search = params.get('search')?.trim() || null
    const dateFromRaw = params.get('dateFrom')
    const dateToRaw = params.get('dateTo')
    const dateFrom = parseCalendarDate(dateFromRaw)
    const dateTo = parseCalendarDate(dateToRaw)
    if ((dateFromRaw && !dateFrom) || (dateToRaw && !dateTo) || (dateFrom && dateTo && dateFrom > dateTo)) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
    }
    const hasPeriod = Boolean(dateFrom || dateTo)

    const dbStartedAt = performance.now()
    const readModelsReady = await performanceReadModelsReady()
    // Period reports already need base transactions. Outside a period we use
    // CustomerSummary only after the all-or-nothing readiness marker exists.
    const useTransactionSource = hasPeriod || !readModelsReady
    const useLegacyNameFallback = useTransactionSource && !readModelsReady
    let allowedAccountIds: string[] | null = null
    if (session.role === UserRole.ACCOUNT_MGR) {
      const access = await db.accountAccess.findMany({
        where: { userId: session.userId },
        select: { accountId: true },
      })
      const scopedAccountIds = access.map((item: { accountId: string }) => item.accountId)
      allowedAccountIds = scopedAccountIds
      if (scopedAccountIds.length === 0) {
        return NextResponse.json({
          success: true,
          data: [],
          pageInfo: { limit, nextCursor: null, hasNext: false, total: 0 },
          generatedAt: new Date().toISOString(),
        }, { headers: { 'Cache-Control': 'private, no-store' } })
      }
    }

    const values: unknown[] = []
    const bind = (value: unknown) => {
      values.push(value)
      return `$${values.length}`
    }
    const predicates: string[] = []
    const alias = useTransactionSource ? 't' : 'cs'
    // This JSON expression is transition-only. It preserves the prior
    // customer directory while the resumable derived-field backfill is in
    // progress; normal production reads use indexed customerName instead.
    const customerNameExpression = useLegacyNameFallback
      ? `COALESCE(
          NULLIF(t."customerName", ''),
          NULLIF(t."rawData"->>'accountName', ''),
          NULLIF(t."rawData"->'sc'->>'accountName', ''),
          NULLIF(mt."rawData"->>'accountName', ''),
          NULLIF(mt."rawData"->'sc'->>'accountName', '')
        )`
      : `${alias}."customerName"`

    if (allowedAccountIds) predicates.push(`${alias}."accountId" = ANY(${bind(allowedAccountIds)}::text[])`)
    if (accountId) predicates.push(`${alias}."accountId" = ${bind(accountId)}`)
    if (currency) predicates.push(`${alias}.currency = ${bind(currency)}`)
    // Push text search down to the source relation so PostgreSQL can use the
    // trigram index instead of aggregating the whole customer directory first.
    if (search) predicates.push(`${customerNameExpression} ILIKE ${bind(`%${search}%`)}`)

    if (useTransactionSource) {
      predicates.push(`${customerNameExpression} IS NOT NULL AND ${customerNameExpression} <> ''`)
      predicates.push(`${alias}."isInternalTransferAuto" = false`)
      predicates.push(`(${alias}."reviewCategory" IS NULL OR ${alias}."reviewCategory" <> 'COMPLAINT')`)
      if (dateFrom) predicates.push(`${alias}."txDateTime" >= ${bind(damascusDayStartUtc(dateFrom))}`)
      if (dateTo) predicates.push(`${alias}."txDateTime" < ${bind(damascusDayStartUtc(addDays(dateTo, 1)))}`)
    }

    const source = useTransactionSource
      ? `
        SELECT ${customerNameExpression} AS "customerName", t."accountId", t.currency, t.type, t.status, t.amount, t."txDateTime"
        FROM "transactions" t
        ${useLegacyNameFallback ? 'LEFT JOIN "transactions" mt ON mt.id = t."matchedTxId"' : ''}
        WHERE ${predicates.join(' AND ') || 'TRUE'}
      `
      : `
        SELECT cs."customerName", cs."accountId", cs.currency,
               cs."depositCount", cs."depositAmount", cs."withdrawalCount", cs."withdrawalAmount",
               cs."matchedCount", cs."pendingCount", cs."discrepancyCount", cs."firstSeen", cs."lastSeen"
        FROM "customer_summaries" cs
        WHERE ${predicates.join(' AND ') || 'TRUE'}
      `

    const aggregates = useTransactionSource
      ? `
        per_currency AS (
          SELECT "customerName", currency,
            count(*) FILTER (WHERE type = 'DEPOSIT')::int AS "depositCount",
            COALESCE(sum(amount) FILTER (WHERE type = 'DEPOSIT'), 0) AS "depositAmount",
            count(*) FILTER (WHERE type = 'WITHDRAWAL')::int AS "withdrawalCount",
            COALESCE(sum(amount) FILTER (WHERE type = 'WITHDRAWAL'), 0) AS "withdrawalAmount"
          FROM scoped GROUP BY "customerName", currency
        ),
        customer_meta AS (
          SELECT "customerName", array_agg(DISTINCT "accountId") AS "accountIds",
            count(*) FILTER (WHERE status = 'MATCHED')::int AS "matchedCount",
            count(*) FILTER (WHERE status IN ('PENDING_SC', 'PENDING_P'))::int AS "pendingCount",
            count(*) FILTER (WHERE status = 'DISCREPANCY')::int AS "discrepancyCount",
            min("txDateTime") AS "firstSeen", max("txDateTime") AS "lastSeen"
          FROM scoped GROUP BY "customerName"
        )
      `
      : `
        per_currency AS (
          SELECT "customerName", currency,
            sum("depositCount")::int AS "depositCount", sum("depositAmount") AS "depositAmount",
            sum("withdrawalCount")::int AS "withdrawalCount", sum("withdrawalAmount") AS "withdrawalAmount"
          FROM scoped GROUP BY "customerName", currency
        ),
        customer_meta AS (
          SELECT "customerName", array_agg(DISTINCT "accountId") AS "accountIds",
            sum("matchedCount")::int AS "matchedCount", sum("pendingCount")::int AS "pendingCount",
            sum("discrepancyCount")::int AS "discrepancyCount", min("firstSeen") AS "firstSeen", max("lastSeen") AS "lastSeen"
          FROM scoped GROUP BY "customerName"
        )
      `

    const scope = createHash('sha256').update(JSON.stringify({ userId: session.userId, role: session.role, allowedAccountIds, accountId, currency, search, dateFrom, dateTo })).digest('hex')
    const cursor = decodeDirectoryCursor(params.get('cursor'), sort, scope)
    const sortExpression = directorySortExpression(sort, ['depositSum', 'withdrawalSum', 'balance'].includes(sort.key) ? bind(sort.currency) : "'USD'")
    const operator = sort.direction === 'asc' ? '>' : '<'
    const direction = sort.direction === 'asc' ? 'ASC' : 'DESC'
    const cursorPredicate = cursor
      ? `WHERE (${sortExpression}, cr.name) ${operator} (${bind(sort.key === 'lastSeen' ? new Date(cursor.value) : cursor.value)}${['name', 'lastSeen'].includes(sort.key) ? '' : '::numeric'}, ${bind(cursor.name)})`
      : ''
    const take = bind(limit + 1)

    const sql = `
      WITH scoped AS (${source}),
      ${aggregates},
      currency_maps AS (
        SELECT "customerName",
          jsonb_object_agg(currency, "depositAmount") AS "depositSum",
          jsonb_object_agg(currency, "withdrawalAmount") AS "withdrawalSum",
          array_agg(currency ORDER BY currency) AS currencies
        FROM per_currency GROUP BY "customerName"
      ),
      customer_rows AS (
        SELECT cm."customerName" AS name, cm."accountIds",
          array_remove(array_agg(DISTINCT a.name), NULL) AS "accountLabels",
          maps.currencies, cm."matchedCount", cm."pendingCount", cm."discrepancyCount",
          cm."firstSeen", cm."lastSeen", maps."depositSum", maps."withdrawalSum",
          COALESCE((SELECT sum(pc."depositCount") FROM per_currency pc WHERE pc."customerName" = cm."customerName"), 0)::int AS "depositCount",
          COALESCE((SELECT sum(pc."withdrawalCount") FROM per_currency pc WHERE pc."customerName" = cm."customerName"), 0)::int AS "withdrawalCount"
        FROM customer_meta cm
        JOIN currency_maps maps ON maps."customerName" = cm."customerName"
        LEFT JOIN "accounts" a ON a.id = ANY(cm."accountIds")
        GROUP BY cm."customerName", cm."accountIds", cm."matchedCount", cm."pendingCount", cm."discrepancyCount",
          cm."firstSeen", cm."lastSeen", maps.currencies, maps."depositSum", maps."withdrawalSum"
      )
      SELECT cr.*, ${sortExpression} AS "sortValue", (SELECT count(*)::int FROM customer_rows) AS total
      FROM customer_rows cr
      ${cursorPredicate}
      ORDER BY ${sortExpression} ${direction}, cr.name ${direction}
      LIMIT ${take}
    `

    // Include every permission/filter/cursor input in the cache key. The HTTP
    // response stays private, and writes immediately invalidate this tag.
    const cacheScope = JSON.stringify({
      route: 'customer-query-v2',
      sort,
      userId: session.userId,
      role: session.role,
      allowedAccountIds: [...(allowedAccountIds || [])].sort(),
      accountId,
      currency,
      search,
      dateFrom,
      dateTo,
      source: useTransactionSource ? (useLegacyNameFallback ? 'transition' : 'transactions') : 'summary',
      cursor: params.get('cursor'),
      limit,
    })
    const rows = await cachedPrivateRead(
      cacheScope,
      [CACHE_TAGS.customers],
      () => db.$queryRawUnsafe(sql, ...values) as Promise<CustomerRow[]>,
    )
    const page = rows.slice(0, limit)
    const hasNext = rows.length > limit
    const data = page.map(row => {
      const depositSum = asNumberMap(row.depositSum)
      const withdrawalSum = asNumberMap(row.withdrawalSum)
      const balance = Object.fromEntries(
        Array.from(new Set([...Object.keys(depositSum), ...Object.keys(withdrawalSum)])).map(currencyCode => [
          currencyCode,
          (depositSum[currencyCode] || 0) - (withdrawalSum[currencyCode] || 0),
        ]),
      )
      const totalOps = Number(row.depositCount) + Number(row.withdrawalCount)
      return {
        name: row.name,
        accountIds: row.accountIds || [],
        accountLabels: row.accountLabels || [],
        currencies: row.currencies || [],
        depositCount: Number(row.depositCount),
        depositSum,
        withdrawalCount: Number(row.withdrawalCount),
        withdrawalSum,
        balance,
        discrepancyCount: Number(row.discrepancyCount),
        matchedCount: Number(row.matchedCount),
        pendingCount: Number(row.pendingCount),
        totalOps,
        trustScore: totalOps > 0
          ? Math.max(0, Math.round((Number(row.matchedCount) / totalOps) * 100 - (Number(row.discrepancyCount) / totalOps) * 20))
          : 0,
        firstSeen: new Date(row.firstSeen).toISOString(),
        lastSeen: new Date(row.lastSeen).toISOString(),
      }
    })

    const payload = {
      success: true,
      data,
      pageInfo: {
        limit,
        nextCursor: hasNext && page.length > 0 ? encodeDirectoryCursor(page[page.length - 1], sort, scope) : null,
        hasNext,
        total: page.length > 0 ? Number(page[0].total) : 0,
      },
      generatedAt: new Date().toISOString(),
    }
    return NextResponse.json(payload, {
      headers: requestMetricsHeaders(startedAt, {
        dbMs: performance.now() - dbStartedAt,
        queryCount: 2 + (session.role === UserRole.ACCOUNT_MGR ? 1 : 0),
        rowCount: data.length,
        responseBytes: estimateJsonBytes(payload),
      }),
    })
  } catch (error) {
    if (error instanceof DirectorySortError) return NextResponse.json({ error: error.message }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } })
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
