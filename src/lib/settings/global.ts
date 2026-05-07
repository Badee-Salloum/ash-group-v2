// Global system settings — defensive key/value store.
// Falls back to the supplied default if the SystemSetting table is missing
// (e.g. before `prisma db push` has been run).

import { db } from '@/lib/db/client'

const cache = new Map<string, { v: string; at: number }>()
const TTL_MS = 30_000

export async function getSystemSetting(key: string, fallback: string): Promise<string> {
  const c = cache.get(key)
  if (c && Date.now() - c.at < TTL_MS) return c.v
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (db as any).systemSetting.findUnique({ where: { key } })
    const v = row?.value ?? fallback
    cache.set(key, { v, at: Date.now() })
    return v
  } catch {
    return fallback
  }
}

export async function setSystemSetting(key: string, value: string, updatedBy?: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).systemSetting.upsert({
      where: { key },
      create: { key, value, updatedBy },
      update: { value, updatedBy },
    })
    cache.set(key, { v: value, at: Date.now() })
  } catch (e) {
    throw new Error('فشل حفظ الإعداد — تأكد من تشغيل `prisma db push` لإنشاء جدول الإعدادات.')
  }
}

// ─── Typed helpers ───
export const SETTING_KEYS = {
  DEFAULT_WEEKLY_OFF_DAYS: 'default_weekly_off_days',
} as const

export async function getDefaultWeeklyOffDays(): Promise<number> {
  const v = await getSystemSetting(SETTING_KEYS.DEFAULT_WEEKLY_OFF_DAYS, '1')
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 && n <= 7 ? n : 1
}

export async function setDefaultWeeklyOffDays(n: number, updatedBy?: string): Promise<void> {
  if (!Number.isInteger(n) || n < 0 || n > 7) throw new Error('قيمة غير صالحة (0-7)')
  await setSystemSetting(SETTING_KEYS.DEFAULT_WEEKLY_OFF_DAYS, String(n), updatedBy)
}
