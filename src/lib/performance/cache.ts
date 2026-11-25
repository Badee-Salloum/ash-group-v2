import { revalidateTag, unstable_cache } from 'next/cache'

export const CACHE_TAGS = {
  financial: 'financial-read-model-v1',
  customers: 'customer-read-model-v1',
  duplicates: 'duplicate-read-model-v1',
} as const

/**
 * Server Data Cache wrapper for authenticated read models. The caller must
 * include the complete permission/account scope in `scopeKey`; HTTP responses
 * remain private/no-store, so cached values can never cross user scopes.
 */
export function cachedPrivateRead<T>(
  scopeKey: string,
  tags: readonly string[],
  loader: () => Promise<T>,
): Promise<T> {
  return unstable_cache(loader, ['private-read-v1', scopeKey], {
    revalidate: 30,
    tags: [...tags],
  })()
}

export function invalidateFinancialReadModels() {
  revalidateTag(CACHE_TAGS.financial)
  revalidateTag(CACHE_TAGS.customers)
  revalidateTag(CACHE_TAGS.duplicates)
}

let firstMeasuredRequest = true

export type RequestMetrics = {
  dbMs?: number
  queryCount?: number
  rowCount?: number
  responseBytes?: number
  requestId?: string
}

/**
 * Estimate a JSON response before it is sent. This is intentionally based on
 * the serialized payload (rather than Content-Length, which can be altered by
 * the platform) and contains no values in logs or headers.
 */
export function estimateJsonBytes(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength
}

/**
 * Safe, request-level timing metadata. It deliberately contains no account,
 * user, transaction, or financial identifiers; Vercel/Neon logs can be
 * correlated by the random request id and deployment region only.
 */
export function requestMetricsHeaders(
  startedAt: number,
  input?: number | RequestMetrics,
): HeadersInit {
  const metrics: RequestMetrics = typeof input === 'number'
    ? { queryCount: input }
    : input || {}
  const totalMs = Math.max(0, Math.round(performance.now() - startedAt))
  const coldStart = firstMeasuredRequest
  firstMeasuredRequest = false
  const requestId = metrics.requestId || crypto.randomUUID()
  const region = process.env.VERCEL_REGION || 'local'
  if (totalMs >= 1_000) {
    console.warn(JSON.stringify({
      event: 'slow_request',
      totalMs,
      dbMs: metrics.dbMs ?? null,
      queryCount: metrics.queryCount ?? null,
      rowCount: metrics.rowCount ?? null,
      responseBytes: metrics.responseBytes ?? null,
      coldStart,
      region,
      requestId,
    }))
  }
  const timing = [
    `app;dur=${totalMs}`,
    metrics.dbMs == null ? null : `db;dur=${Math.max(0, Math.round(metrics.dbMs))}`,
  ].filter(Boolean).join(', ')
  return {
    'Cache-Control': 'private, no-store',
    'Server-Timing': timing,
    'X-Request-Id': requestId,
    'X-Deployment-Region': region,
    ...(metrics.dbMs == null ? {} : { 'X-Db-Ms': String(Math.max(0, Math.round(metrics.dbMs)))}),
    ...(metrics.queryCount == null ? {} : { 'X-Query-Count': String(metrics.queryCount)}),
    ...(metrics.rowCount == null ? {} : { 'X-Row-Count': String(metrics.rowCount)}),
    ...(metrics.responseBytes == null ? {} : { 'X-Response-Bytes': String(metrics.responseBytes)}),
  }
}
