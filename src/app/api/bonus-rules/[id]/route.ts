// Phase D — single bonus rule get/update.
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

const patchSchema = z.object({
  description: z.string().nullable().optional(),
  interval: z.enum(['WEEKLY', 'DAILY']).optional(),
  amountType: z.enum(['FIXED', 'PERCENT', 'TIERED']).optional(),
  baseAmount: z.number().nonnegative().nullable().optional(),
  basePercent: z.number().nonnegative().max(100).nullable().optional(),
  maxStreak: z.number().int().positive().nullable().optional(),
  cumulative: z.boolean().optional(),
  isActive: z.boolean().optional(),
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
  tiers: Array<{
    id: string
    streakMin: number
    streakMax: number | null
    amount: unknown
    percent: unknown
    order: number
  }>
}

function serialize(r: RuleRow) {
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

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])
    const rule = await db.bonusRule.findUnique({
      where: { id: params.id },
      include: { tiers: { orderBy: { streakMin: 'asc' } } },
    }) as RuleRow | null
    if (!rule) return NextResponse.json({ error: 'القاعدة غير موجودة' }, { status: 404 })
    return NextResponse.json({ success: true, rule: serialize(rule) })
  } catch (error) {
    if (String(error) === 'Error: FORBIDDEN') {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])
    const data = patchSchema.parse(await req.json())

    const existing = await db.bonusRule.findUnique({ where: { id: params.id } })
    if (!existing) return NextResponse.json({ error: 'القاعدة غير موجودة' }, { status: 404 })

    const tiers = data.tiers
    const updated = await db.$transaction(async (tx: typeof db) => {
      if (data.isActive === true) {
        await tx.bonusRule.updateMany({
          where: { isActive: true, NOT: { id: params.id } },
          data: { isActive: false },
        })
      }
      await tx.bonusRule.update({
        where: { id: params.id },
        data: {
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.interval !== undefined ? { interval: data.interval } : {}),
          ...(data.amountType !== undefined ? { amountType: data.amountType } : {}),
          ...(data.baseAmount !== undefined ? { baseAmount: data.baseAmount } : {}),
          ...(data.basePercent !== undefined ? { basePercent: data.basePercent } : {}),
          ...(data.maxStreak !== undefined ? { maxStreak: data.maxStreak } : {}),
          ...(data.cumulative !== undefined ? { cumulative: data.cumulative } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          ...(data.targetRoles !== undefined ? { targetRoles: data.targetRoles } : {}),
        },
      })
      if (tiers) {
        await tx.tierRule.deleteMany({ where: { bonusRuleId: params.id } })
        if (tiers.length > 0) {
          await tx.tierRule.createMany({
            data: tiers.map((t, i) => ({
              bonusRuleId: params.id,
              streakMin: t.streakMin,
              streakMax: t.streakMax ?? null,
              amount: t.amount ?? null,
              percent: t.percent ?? null,
              order: t.order ?? i,
            })),
          })
        }
      }
      return tx.bonusRule.findUnique({
        where: { id: params.id },
        include: { tiers: { orderBy: { streakMin: 'asc' } } },
      }) as Promise<RuleRow>
    })

    await audit(session.userId, 'UPDATE_BONUS_RULE', 'BonusRule', params.id, {
      changes: data, tierCount: tiers?.length,
    })
    return NextResponse.json({ success: true, rule: serialize(updated) })
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
