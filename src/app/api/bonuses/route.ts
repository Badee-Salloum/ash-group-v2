import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { RESET_CATEGORIES } from '@/lib/compensation/cumulativeBonus'
import { getActiveBonusRule, applyBonusRule } from '@/lib/compensation/bonusRules'
import { createBonusNotification } from '@/lib/notifications/helpers'
import { z } from 'zod'

// Modules I & J — Cumulative + Group bonuses.
//
// POST /api/bonuses
//   { type: 'GROUP', amount, reason, userIds: [...], weekStart? } → bulk insert
//   { type: 'MANUAL', amount, reason, userId, weekStart? }
//   { type: 'CUMULATIVE', accrueForWeekStart } → auto-accrue clean weeks
//
// Cumulative logic (Module I):
// For each active employee, look at the previous week. If they had no errors
// (no transactions reviewed as EMPLOYEE_ERROR or THEFT during their sessions),
// add 5 USD to last week's cumulative bonus + base. Otherwise reset to 0.

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - day)
  monday.setHours(0, 0, 0, 0)
  return monday
}

// Group and Manual bonuses accept EITHER `amount` (a fixed SYP value applied
// uniformly) OR `percent` (0–100 of each user's baseSalary; computed
// per-user server-side). When `percent` is supplied, employees without a
// baseSalary are skipped — the response counts them under `skippedNoSalary`.
const groupSchema = z.object({
  type: z.literal('GROUP'),
  amount: z.number().positive().optional(),
  percent: z.number().positive().max(100).optional(),
  reason: z.string().optional(),
  userIds: z.array(z.string()).min(1),
  weekStart: z.string().optional(),
})

const manualSchema = z.object({
  type: z.literal('MANUAL'),
  amount: z.number().optional(),
  percent: z.number().positive().max(100).optional(),
  reason: z.string().optional(),
  userId: z.string(),
  weekStart: z.string().optional(),
})

const cumulativeSchema = z.object({
  type: z.literal('CUMULATIVE'),
  weekStart: z.string(),  // the week we are accruing FOR
  baseIncrement: z.number().default(5),
})

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const userId = req.nextUrl.searchParams.get('userId')
  const weekStart = req.nextUrl.searchParams.get('weekStart')
  const where: Record<string, unknown> = {}
  if (userId) where.userId = userId
  if (weekStart) where.weekStart = startOfWeek(new Date(weekStart))

  const list = await db.bonusLog.findMany({
    where,
    include: {
      user: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  return NextResponse.json({
    success: true,
    data: list.map((b: typeof list[0]) => ({ ...b, amount: Number(b.amount) })),
  })
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const body = await req.json()
    const type = body?.type
    const ws = (raw?: string) => raw ? startOfWeek(new Date(raw)) : startOfWeek(new Date())

    if (type === 'GROUP') {
      const data = groupSchema.parse(body)
      if ((data.amount == null) === (data.percent == null)) {
        return NextResponse.json(
          { error: 'حدّد إما المبلغ أو النسبة، وليس كليهما' },
          { status: 400 },
        )
      }
      const weekStart = ws(data.weekStart)
      // Percent mode: fetch baseSalary for each target user, compute the
      // per-user amount on the server. Users without a salary are skipped
      // but reported in the response.
      let rows: Array<{ userId: string; amount: number; reasonTag: string | null }>
      let skippedNoSalary: string[] = []
      if (data.percent != null) {
        const users = await db.user.findMany({
          where: { id: { in: data.userIds } },
          select: { id: true, baseSalary: true },
        })
        const byId = new Map<string, number | null>()
        for (const u of users as Array<{ id: string; baseSalary: unknown }>) {
          byId.set(u.id, u.baseSalary != null ? Number(u.baseSalary) : null)
        }
        rows = []
        for (const uid of data.userIds) {
          const salary = byId.get(uid)
          if (salary == null || salary <= 0) { skippedNoSalary.push(uid); continue }
          rows.push({
            userId: uid,
            amount: Math.round((salary * data.percent) / 100),
            reasonTag: `[${data.percent}%]`,
          })
        }
      } else {
        rows = data.userIds.map(uid => ({
          userId: uid,
          amount: data.amount!,
          reasonTag: null,
        }))
      }
      if (rows.length === 0) {
        return NextResponse.json(
          { error: 'لا يوجد موظف يملك راتباً أساسياً لتطبيق النسبة', skippedNoSalary },
          { status: 400 },
        )
      }
      await db.bonusLog.createMany({
        data: rows.map(r => ({
          userId: r.userId,
          amount: r.amount,
          type: 'GROUP',
          reason: r.reasonTag
            ? `${r.reasonTag}${data.reason ? ' ' + data.reason : ''}`
            : data.reason,
          createdById: session.userId,
          weekStart,
          appliedAt: new Date(),
        })),
      })
      await audit(session.userId, 'ADD_GROUP_BONUS', 'BonusLog', null as unknown as string, {
        userIds: data.userIds, amount: data.amount, percent: data.percent, weekStart,
        applied: rows.length, skippedNoSalary,
      })
      // Fire-and-forget per-user notifications. safeCreate inside the helper
      // swallows errors so a notification failure doesn't break the bonus.
      await Promise.all(rows.map(r => createBonusNotification({
        userId: r.userId, amount: r.amount, type: 'GROUP', reason: data.reason ?? null, weekStart,
      })))
      return NextResponse.json({
        success: true,
        count: rows.length,
        skippedNoSalary: skippedNoSalary.length || undefined,
      })
    }

    if (type === 'MANUAL') {
      const data = manualSchema.parse(body)
      if ((data.amount == null) === (data.percent == null)) {
        return NextResponse.json(
          { error: 'حدّد إما المبلغ أو النسبة، وليس كليهما' },
          { status: 400 },
        )
      }
      const weekStart = ws(data.weekStart)
      let amount: number
      let reasonTag = ''
      if (data.percent != null) {
        const u = await db.user.findUnique({
          where: { id: data.userId }, select: { baseSalary: true },
        })
        const salary = u?.baseSalary != null ? Number(u.baseSalary) : null
        if (!salary || salary <= 0) {
          return NextResponse.json(
            { error: 'الموظف بدون راتب أساس — تعذّر حساب النسبة' },
            { status: 400 },
          )
        }
        amount = Math.round((salary * data.percent) / 100)
        reasonTag = `[${data.percent}%]`
      } else {
        amount = data.amount!
      }
      const created = await db.bonusLog.create({
        data: {
          userId: data.userId,
          amount,
          type: 'MANUAL',
          reason: reasonTag
            ? `${reasonTag}${data.reason ? ' ' + data.reason : ''}`
            : data.reason,
          createdById: session.userId,
          weekStart,
          appliedAt: new Date(),
        },
      })
      await audit(session.userId, 'ADD_MANUAL_BONUS', 'BonusLog', created.id, {
        ...data, computedAmount: amount,
      })
      await createBonusNotification({
        userId: data.userId, amount, type: 'MANUAL', reason: data.reason ?? null, weekStart,
      })
      return NextResponse.json({ success: true, id: created.id })
    }

    if (type === 'CUMULATIVE') {
      const data = cumulativeSchema.parse(body)
      const weekStart = ws(data.weekStart)
      const prevWeekStart = new Date(weekStart)
      prevWeekStart.setDate(prevWeekStart.getDate() - 7)
      const prevWeekEnd = new Date(weekStart)
      prevWeekEnd.setHours(0, 0, 0, 0)

      // Resolve the per-week increment from the active BonusRule. When no
      // rule is configured we fall back to the request's baseIncrement
      // (default 5,000) so the legacy behavior keeps working.
      const activeRule = await getActiveBonusRule()
      const ruleId = activeRule?.id ?? null

      // Get all active employees (pull baseSalary for PERCENT-type rules)
      const employees = await db.user.findMany({
        where: { isActive: true, role: { in: ['EMPLOYEE', 'MANAGER', 'SHIFT_MANAGER', 'SUPERVISOR', 'ACCOUNT_MGR'] } },
        select: { id: true, baseSalary: true },
      })

      let accrued = 0, reset = 0
      for (const emp of employees) {
        // Did they make any errors in the previous week?
        const errorCount = await db.transaction.count({
          where: {
            handledByUserId: emp.id,
            txDateTime: { gte: prevWeekStart, lt: prevWeekEnd },
            reviewCategory: { in: RESET_CATEGORIES as unknown as string[] },
          },
        })

        if (errorCount > 0) {
          // Reset cumulative bonus for this week (no entry — equivalent to 0)
          reset++
          continue
        }
        // Get last cumulative bonus to accumulate
        const last = await db.bonusLog.findFirst({
          where: { userId: emp.id, type: 'CUMULATIVE' },
          orderBy: { weekStart: 'desc' },
        })
        const previousAmount = last && last.weekStart && last.weekStart >= prevWeekStart
          ? Number(last.amount)
          : 0
        const salary = emp.baseSalary != null ? Number(emp.baseSalary) : null
        // Per-week increment from the active rule (applyBonusRule with
        // cleanStreak=1 yields the single-interval delta). Falls back to
        // request param when no rule is configured.
        const increment = activeRule
          ? applyBonusRule(1, activeRule.config, salary)
          : data.baseIncrement
        const newAmount = previousAmount + increment

        // Skip if already exists for this week
        const existing = await db.bonusLog.findFirst({
          where: { userId: emp.id, type: 'CUMULATIVE', weekStart },
        })
        if (existing) {
          await db.bonusLog.update({
            where: { id: existing.id },
            data: { amount: newAmount, appliedAt: new Date(), ruleId },
          })
        } else {
          await db.bonusLog.create({
            data: {
              userId: emp.id,
              amount: newAmount,
              type: 'CUMULATIVE',
              reason: activeRule
                ? `أسبوع نظيف — ${activeRule.name} (+${increment.toLocaleString('en')})`
                : `أسبوع نظيف — تراكم ${increment}`,
              createdById: session.userId,
              weekStart,
              appliedAt: new Date(),
              ruleId,
            },
          })
        }
        accrued++
      }
      await audit(session.userId, 'ACCRUE_CUMULATIVE_BONUSES', 'BonusLog', null as unknown as string, {
        weekStart, accrued, reset, ruleId, ruleName: activeRule?.name,
      })
      return NextResponse.json({ success: true, accrued, reset, ruleName: activeRule?.name })
    }

    return NextResponse.json({ error: 'type غير صالح' }, { status: 400 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id مطلوب' }, { status: 400 })

  const bonus = await db.bonusLog.findUnique({ where: { id } })
  if (!bonus) return NextResponse.json({ error: 'المكافأة غير موجودة' }, { status: 404 })

  // Refuse deletion if the user's payroll for that week is already PAID —
  // the bonus is part of a finalized salary snapshot.
  if (bonus.weekStart) {
    const paidEntry = await db.payrollEntry.findFirst({
      where: { userId: bonus.userId, weekStart: bonus.weekStart, status: 'PAID' },
      select: { id: true },
    })
    if (paidEntry) {
      return NextResponse.json(
        { error: 'لا يمكن حذف مكافأة مدفوعة (الراتب لهذا الأسبوع مدفوع بالفعل).' },
        { status: 400 },
      )
    }
  }

  await db.bonusLog.delete({ where: { id } })
  await audit(session.userId, 'DELETE_BONUS', 'BonusLog', id, {
    type: bonus.type, amount: Number(bonus.amount), userId: bonus.userId,
  })
  return NextResponse.json({ success: true })
}
