// Phase D — bonus rule list/create/soft-disable.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

const tierSchema = z.object({
  streakMin: z.number().int().nonnegative(),
  streakMax: z.number().int().nonnegative().nullable().optional(),
  amount: z.number().nonnegative().nullable().optional(),
  percent: z.number().nonnegative().max(100).nullable().optional(),
  order: z.number().int().optional(),
})

const ROLE_VALUES = ['ADMIN', 'SUPERVISOR', 'ACCOUNT_MGR', 'MANAGER', 'EMPLOYEE', 'SHIFT_MANAGER'] as const

const createSchema = z.object({
  name: z.string().trim().min(1, 'الاسم مطلوب'),
  description: z.string().nullable().optional(),
  interval: z.enum(['WEEKLY', 'DAILY']).default('WEEKLY'),
  amountType: z.enum(['FIXED', 'PERCENT', 'TIERED']),
  baseAmount: z.number().nonnegative().nullable().optional(),
  basePercent: z.number().nonnegative().max(100).nullable().optional(),
  maxStreak: z.number().int().positive().nullable().optional(),
  cumulative: z.boolean().default(true),
  isActive: z.boolean().default(true),
  targetRoles: z.array(z.enum(ROLE_VALUES)).optional(),
  tiers: z.array(tierSchema).optional(),
})

type RuleRow = {
  id: string
  name: string
  description: string | null
  interval: string
  amountType: string
  baseAmount: unknown
  basePercent: unknown
  maxStreak: number | null
  cumulative: boolean
  isActive: boolean
  targetRoles: string[]
  createdAt: Date
  updatedAt: Date
  tiers: Array<{
    id: string
    streakMin: number
    streakMax: number | null
    amount: unknown
    percent: unknown
    order: number
  }>
}

function serializeRule(r: RuleRow) {
  return {
    ...r,
    baseAmount: r.baseAmount != null ? Number(r.baseAmount) : null,
    basePercent: r.basePercent != null ? Number(r.basePercent) : null,
    tiers: r.tiers.map(t => ({
      ...t,
      amount: t.amount != null ? Number(t.amount) : null,
      percent: t.percent != null ? Number(t.percent) : null,
    })),
  }
}

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    // MANAGER has the same authority as ADMIN over bonus rules per the
    // user's "صلاحية كاملة لمدير الفرع" direction.
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])
    const rules = await db.bonusRule.findMany({
      orderBy: { createdAt: 'desc' },
      include: { tiers: { orderBy: { streakMin: 'asc' } } },
    }) as RuleRow[]
    return NextResponse.json({
      success: true,
      data: rules.map(serializeRule),
    })
  } catch (error) {
    if (String(error) === 'Error: FORBIDDEN') {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    // MANAGER has the same authority as ADMIN over bonus rules per the
    // user's "صلاحية كاملة لمدير الفرع" direction.
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])
    const data = createSchema.parse(await req.json())

    // Enforce: single rule constraints by type
    if (data.amountType === 'FIXED' && (data.baseAmount == null || data.baseAmount <= 0)) {
      return NextResponse.json({ error: 'حدّد المبلغ الأساسي للنوع الثابت' }, { status: 400 })
    }
    if (data.amountType === 'PERCENT' && (data.basePercent == null || data.basePercent <= 0)) {
      return NextResponse.json({ error: 'حدّد النسبة الأساسية للنوع النسبي' }, { status: 400 })
    }
    if (data.amountType === 'TIERED' && (!data.tiers || data.tiers.length === 0)) {
      return NextResponse.json({ error: 'حدّد طبقة واحدة على الأقل' }, { status: 400 })
    }

    const tiers = data.tiers ?? []
    const created = await db.$transaction(async (tx: typeof db) => {
      if (data.isActive) {
        await tx.bonusRule.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        })
      }
      const rule = await tx.bonusRule.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          interval: data.interval,
          amountType: data.amountType,
          baseAmount: data.baseAmount ?? null,
          basePercent: data.basePercent ?? null,
          maxStreak: data.maxStreak ?? null,
          cumulative: data.cumulative,
          isActive: data.isActive,
          targetRoles: data.targetRoles ?? [],
          tiers: tiers.length > 0
            ? {
                create: tiers.map((t, i) => ({
                  streakMin: t.streakMin,
                  streakMax: t.streakMax ?? null,
                  amount: t.amount ?? null,
                  percent: t.percent ?? null,
                  order: t.order ?? i,
                })),
              }
            : undefined,
        },
        include: { tiers: { orderBy: { streakMin: 'asc' } } },
      })
      return rule as RuleRow
    })

    await audit(session.userId, 'CREATE_BONUS_RULE', 'BonusRule', created.id, {
      name: data.name, amountType: data.amountType, isActive: data.isActive,
      tierCount: tiers.length,
    })
    return NextResponse.json({ success: true, id: created.id, rule: serializeRule(created) })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    if (String(error) === 'Error: FORBIDDEN') {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    // MANAGER has the same authority as ADMIN over bonus rules per the
    // user's "صلاحية كاملة لمدير الفرع" direction.
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id مطلوب' }, { status: 400 })

    const existing = await db.bonusRule.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'القاعدة غير موجودة' }, { status: 404 })

    await db.bonusRule.update({
      where: { id },
      data: { isActive: false },
    })
    await audit(session.userId, 'DISABLE_BONUS_RULE', 'BonusRule', id, {
      name: existing.name,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (String(error) === 'Error: FORBIDDEN') {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
