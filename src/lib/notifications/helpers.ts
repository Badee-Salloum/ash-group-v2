// Helpers to create per-user Notification rows. All functions swallow errors
// internally — they're meant to be fire-and-forget side effects of API
// handlers and must never disrupt the parent transaction.

import { db } from '@/lib/db/client'

type AnyJson = Record<string, unknown>

async function safeCreate(data: {
  userId: string
  type: string
  title: string
  body?: string | null
  href?: string | null
  payload?: AnyJson
}) {
  try {
    return await db.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        body: data.body ?? null,
        href: data.href ?? null,
        payload: (data.payload as AnyJson) ?? undefined,
      },
    })
  } catch (e) {
    console.warn('[notifications] create failed:', e instanceof Error ? e.message : e)
    return null
  }
}

export function createBonusNotification(input: {
  userId: string
  amount: number
  type?: string
  reason?: string | null
  weekStart?: Date | string | null
}) {
  return safeCreate({
    userId: input.userId,
    type: 'BONUS_RECEIVED',
    title: `مكافأة جديدة: ${input.amount.toLocaleString('en')} ل.س`,
    body: input.reason ?? null,
    href: '/my',
    payload: { ...input },
  })
}

export function createDeductionNotification(input: {
  userId: string
  amount: number
  reason?: string | null
  weekStart?: Date | string | null
}) {
  return safeCreate({
    userId: input.userId,
    type: 'DEDUCTION_APPLIED',
    title: `خصم على راتبك: ${input.amount.toLocaleString('en')} ل.س`,
    body: input.reason ?? null,
    href: '/my',
    payload: { ...input },
  })
}

export function createPayrollPaidNotification(input: {
  userId: string
  netAmount: number
  weekStart: Date | string
  // Optional — when provided, the title + body break the payout down
  // into salary vs bonus so a "0 salary + big cumulative bonus" payout
  // doesn't read as "تم دفع راتبك (0 ل.س)".
  salaryAmount?: number
  bonusAmount?: number
}) {
  const wkStr = input.weekStart instanceof Date
    ? input.weekStart.toISOString().slice(0, 10)
    : String(input.weekStart).slice(0, 10)

  const salary = input.salaryAmount ?? input.netAmount
  const bonus = input.bonusAmount ?? 0
  const total = salary + bonus

  // Headline: lead with whichever component is non-zero. When both
  // are present, summarise the total + show the split in the body.
  let title: string
  let body: string | null = null
  if (bonus > 0 && salary > 0) {
    title = `تم دفع مستحقاتك لأسبوع ${wkStr} (${total.toLocaleString('en')} ل.س)`
    body = `راتب ${salary.toLocaleString('en')} ل.س · مكافأة ${bonus.toLocaleString('en')} ل.س`
  } else if (bonus > 0) {
    title = `تم دفع مكافأتك (${bonus.toLocaleString('en')} ل.س)`
    body = `لأسبوع ${wkStr}`
  } else {
    title = `تم دفع راتبك (${salary.toLocaleString('en')} ل.س)`
    body = `لأسبوع ${wkStr}`
  }

  return safeCreate({
    userId: input.userId,
    type: 'PAYROLL_PAID',
    title,
    body,
    href: '/compensation',
    payload: { ...input, weekStart: wkStr },
  })
}

const CATEGORY_AR: Record<string, string> = {
  COMPLAINT: 'شكوى',
  CUSTOMER_ERROR: 'خطأ زبون',
  PLATFORM_ERROR: 'خطأ منصة',
}

export function createComplaintAttributedNotification(input: {
  userId: string
  category: string
  transactionId: string
}) {
  const label = CATEGORY_AR[input.category] || 'متابعة'
  return safeCreate({
    userId: input.userId,
    type: 'COMPLAINT_ATTRIBUTED',
    title: `تم إسناد ${label} إليك`,
    body: 'تم تكليفك بمتابعتها.',
    href: '/follow-ups',
    payload: { ...input },
  })
}

export function createAdvanceDecisionNotification(input: {
  userId: string
  amount: number
  approved: boolean
  reason?: string | null
}) {
  const approved = input.approved
  return safeCreate({
    userId: input.userId,
    type: approved ? 'ADVANCE_APPROVED' : 'ADVANCE_REJECTED',
    title: approved
      ? `تمت الموافقة على سلفتك (${input.amount.toLocaleString('en')} ل.س)`
      : `تم رفض طلب السلفة (${input.amount.toLocaleString('en')} ل.س)`,
    body: input.reason ?? null,
    href: '/my',
    payload: { ...input },
  })
}

export function createScheduleAssignedNotification(input: {
  userId: string
  date: Date | string
  shiftNumber: number
}) {
  const d = input.date instanceof Date ? input.date.toISOString().slice(0, 10) : String(input.date).slice(0, 10)
  return safeCreate({
    userId: input.userId,
    type: 'SCHEDULE_ASSIGNED',
    title: `تم إسناد وردية رقم ${input.shiftNumber} بتاريخ ${d}`,
    body: null,
    href: '/schedule',
    payload: { ...input, date: d },
  })
}
