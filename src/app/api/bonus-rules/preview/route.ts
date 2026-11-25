// Phase D — live preview of a rule (used by the form's right-side preview).
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { applyBonusRule, summarizeRule, RuleConfig } from '@/lib/compensation/bonusRules'

const tierSchema = z.object({
  streakMin: z.number().int().nonnegative(),
  streakMax: z.number().int().nonnegative().nullable().optional(),
  amount: z.number().nonnegative().nullable().optional(),
  percent: z.number().nonnegative().max(100).nullable().optional(),
})

const configSchema = z.object({
  amountType: z.enum(['FIXED', 'PERCENT', 'TIERED']),
  baseAmount: z.number().nonnegative().optional(),
  basePercent: z.number().nonnegative().max(100).optional(),
  maxStreak: z.number().int().positive().optional(),
  cumulative: z.boolean().default(true),
  tiers: z.array(tierSchema).default([]),
})

const bodySchema = z.object({
  config: configSchema,
  cleanStreak: z.number().int().nonnegative(),
  baseSalary: z.number().nonnegative().optional(),
  name: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    const data = bodySchema.parse(await req.json())
    const config: RuleConfig = {
      amountType: data.config.amountType,
      baseAmount: data.config.baseAmount,
      basePercent: data.config.basePercent,
      maxStreak: data.config.maxStreak,
      cumulative: data.config.cumulative,
      targetRoles: [],
      tiers: data.config.tiers.map(t => ({
        streakMin: t.streakMin,
        streakMax: t.streakMax ?? null,
        amount: t.amount ?? null,
        percent: t.percent ?? null,
      })),
    }
    const amount = applyBonusRule(data.cleanStreak, config, data.baseSalary ?? null)
    const summary = summarizeRule({ name: data.name ?? '', config }, data.cleanStreak, data.baseSalary)
    return NextResponse.json({ success: true, amount, summary })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
