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
  PAYROLL_EPOCH_START: 'payroll_epoch_start',
  BONUS_ERROR_RATIO_LIMIT: 'bonus_error_ratio_limit',
  BONUS_ERROR_AMOUNT_LIMITS: 'bonus_error_amount_limits',
  BONUS_DELAY_LIMIT: 'bonus_delay_limit',
} as const

export async function getDefaultWeeklyOffDays(): Promise<number> {
  // Default is now 0 — i.e. a 7-day workweek. Admins still override
  // both globally (/settings) and per-employee (UserFormModal).
  const v = await getSystemSetting(SETTING_KEYS.DEFAULT_WEEKLY_OFF_DAYS, '0')
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 && n <= 7 ? n : 0
}

export async function setDefaultWeeklyOffDays(n: number, updatedBy?: string): Promise<void> {
  if (!Number.isInteger(n) || n < 0 || n > 7) throw new Error('قيمة غير صالحة (0-7)')
  await setSystemSetting(SETTING_KEYS.DEFAULT_WEEKLY_OFF_DAYS, String(n), updatedBy)
}

// Epoch floor for all payroll / bonus accounting. Any week strictly before
// this date is invisible to the cumulative-streak walker and is the target
// of the admin "wipe-history" action. Stored as YYYY-MM-DD Sunday.
const PAYROLL_EPOCH_DEFAULT = '2026-06-28'

export async function getPayrollEpochStart(): Promise<string> {
  const v = await getSystemSetting(SETTING_KEYS.PAYROLL_EPOCH_START, PAYROLL_EPOCH_DEFAULT)
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : PAYROLL_EPOCH_DEFAULT
}

export async function setPayrollEpochStart(date: string, updatedBy?: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('صيغة تاريخ غير صالحة (YYYY-MM-DD)')
  // Must land on a Sunday so the value lines up with startOfWeek().
  const d = new Date(`${date}T12:00:00Z`)
  if (d.getUTCDay() !== 0) throw new Error('يجب أن يكون التاريخ يوم أحد (بداية الأسبوع)')
  await setSystemSetting(SETTING_KEYS.PAYROLL_EPOCH_START, date, updatedBy)
}

// ─── Bonus streak thresholds ───

export interface BonusThresholds {
  ratioLimit: number
  amountLimits: Record<string, number>
  delayLimit: number
}

export async function getBonusThresholds(): Promise<BonusThresholds> {
  const [ratioStr, amountStr, delayStr] = await Promise.all([
    getSystemSetting(SETTING_KEYS.BONUS_ERROR_RATIO_LIMIT, '0.001'),
    getSystemSetting(SETTING_KEYS.BONUS_ERROR_AMOUNT_LIMITS, '{"USD":20,"SYP":20}'),
    getSystemSetting(SETTING_KEYS.BONUS_DELAY_LIMIT, '0'),
  ])
  const ratioLimit = Number.isFinite(Number(ratioStr)) ? Math.max(0, Number(ratioStr)) : 0.001
  let amountLimits: Record<string, number> = {}
  try {
    const parsed = JSON.parse(amountStr) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const n = Number(v)
        if (Number.isFinite(n) && n >= 0) amountLimits[k] = n
      }
    }
  } catch { amountLimits = { USD: 20, SYP: 20 } }
  const delayLimit = Number.isFinite(Number(delayStr)) ? Math.max(0, Math.floor(Number(delayStr))) : 0
  return { ratioLimit, amountLimits, delayLimit }
}

export async function setBonusThresholds(t: Partial<BonusThresholds>, updatedBy?: string): Promise<void> {
  if (t.ratioLimit !== undefined) {
    if (!Number.isFinite(t.ratioLimit) || t.ratioLimit < 0 || t.ratioLimit > 1) {
      throw new Error('نسبة الأخطاء يجب أن تكون بين 0 و 1')
    }
    await setSystemSetting(SETTING_KEYS.BONUS_ERROR_RATIO_LIMIT, String(t.ratioLimit), updatedBy)
  }
  if (t.amountLimits !== undefined) {
    for (const [k, v] of Object.entries(t.amountLimits)) {
      if (!Number.isFinite(v) || v < 0) throw new Error(`قيمة غير صالحة للعملة ${k}`)
    }
    await setSystemSetting(SETTING_KEYS.BONUS_ERROR_AMOUNT_LIMITS, JSON.stringify(t.amountLimits), updatedBy)
  }
  if (t.delayLimit !== undefined) {
    if (!Number.isFinite(t.delayLimit) || t.delayLimit < 0) throw new Error('حدّ التأخيرات يجب أن يكون رقماً موجباً')
    await setSystemSetting(SETTING_KEYS.BONUS_DELAY_LIMIT, String(Math.floor(t.delayLimit)), updatedBy)
  }
}
