import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db/client'
import { CACHE_TAGS } from '@/lib/performance/cache'

/**
 * The backfill sets this marker only after all additive read models are
 * complete. Cache it briefly so a marker lookup does not become an extra
 * query on every hot endpoint; a false value merely keeps the exact fallback
 * active for at most 30 seconds.
 */
const readPerformanceModelMarker = unstable_cache(async () => {
  try {
    const rows = await db.$queryRawUnsafe(
      `SELECT "value" FROM "performance_backfill_state" WHERE "key" = $1 LIMIT 1`,
      'financial-read-model-v1',
    ) as Array<{ value: string }>
    return Boolean(rows[0]?.value)
  } catch {
    // The expand migration has not been installed yet.
    return false
  }
}, ['performance-read-model-ready-v1'], {
  revalidate: 30,
  tags: [CACHE_TAGS.financial],
})

export function performanceReadModelsReady(): Promise<boolean> {
  return readPerformanceModelMarker()
}
