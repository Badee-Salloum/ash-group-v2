// Phase D — configurable bonus rule engine. Single active rule at a time.
import { db } from '@/lib/db/client'
import { getSystemSetting, setSystemSetting } from '@/lib/settings/global'

export const DEFAULT_RULE_NAME = 'القاعدة الافتراضية'

// One-shot flag — the first time getActiveBonusRule() runs after this
// deploy, the auto-created default rule is deactivated. The user asked
// to cancel the inherited 5,000 SYP/week default; subsequent rules from
// /bonus-rules are untouched.
const DEFAULT_CANCEL_FLAG_KEY = 'default_bonus_rule_canceled'

export interface TierConfig {
  streakMin: number
  streakMax: number | null
  amount: number | null
  percent: number | null
}

export interface RuleConfig {
  amountType: 'FIXED' | 'PERCENT' | 'TIERED'
  baseAmount?: number
  basePercent?: number
  maxStreak?: number
  cumulative: boolean
  tiers: TierConfig[]
  // Roles the rule applies to. Empty array = no restriction (applies to
  // any employee). When non-empty, the user's role must match exactly.
  targetRoles: string[]
}

type RuleRow = {
  id: string
  name: string
  amountType: string
  baseAmount: unknown
  basePercent: unknown
  maxStreak: number | null
  cumulative: boolean
  targetRoles: string[] | null
  tiers: Array<{
    streakMin: number
    streakMax: number | null
    amount: unknown
    percent: unknown
    order: number
  }>
}

function toNum(v: unknown): number | undefined {
  if (v == null) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function rowToConfig(row: RuleRow): RuleConfig {
  return {
    amountType: row.amountType as RuleConfig['amountType'],
    baseAmount: toNum(row.baseAmount),
    basePercent: toNum(row.basePercent),
    maxStreak: row.maxStreak ?? undefined,
    cumulative: row.cumulative,
    targetRoles: Array.isArray(row.targetRoles) ? row.targetRoles : [],
    tiers: row.tiers
      .slice()
      .sort((a, b) => a.streakMin - b.streakMin)
      .map(t => ({
        streakMin: t.streakMin,
        streakMax: t.streakMax,
        amount: toNum(t.amount) ?? null,
        percent: toNum(t.percent) ?? null,
      })),
  }
}

// Idempotent one-shot — deactivate the inherited default rule the first
// time anyone reads the active rule after this code lands. Honors the
// "cancel default" instruction the user gave with this change.
async function cancelDefaultRuleOnce(): Promise<void> {
  const done = await getSystemSetting(DEFAULT_CANCEL_FLAG_KEY, '')
  if (done === '1') return
  try {
    await db.bonusRule.updateMany({
      where: { name: DEFAULT_RULE_NAME, isActive: true },
      data: { isActive: false },
    })
  } finally {
    await setSystemSetting(DEFAULT_CANCEL_FLAG_KEY, '1')
  }
}

export async function getActiveBonusRule(): Promise<{ id: string; name: string; config: RuleConfig } | null> {
  await cancelDefaultRuleOnce()
  const row = await db.bonusRule.findFirst({
    where: { isActive: true },
    include: { tiers: { orderBy: { streakMin: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  }) as RuleRow | null
  if (!row) return null
  return { id: row.id, name: row.name, config: rowToConfig(row) }
}

// Predicate split out for clarity — does this rule apply to this role?
// Empty targetRoles = no restriction.
export function ruleAppliesToRole(config: RuleConfig, userRole: string | null | undefined): boolean {
  if (!config.targetRoles || config.targetRoles.length === 0) return true
  return userRole != null && config.targetRoles.includes(userRole)
}

export function applyBonusRule(
  cleanStreak: number,
  config: RuleConfig,
  baseSalary: number | null,
): number {
  if (cleanStreak <= 0) return 0
  const cap = config.maxStreak && config.maxStreak > 0 ? config.maxStreak : Infinity
  const effective = Math.min(cleanStreak, cap)

  if (config.amountType === 'FIXED') {
    const per = config.baseAmount ?? 0
    if (config.cumulative) return Math.round(per * effective)
    return Math.round(per)
  }

  if (config.amountType === 'PERCENT') {
    if (!baseSalary || baseSalary <= 0 || !config.basePercent) return 0
    const per = Math.round((baseSalary * config.basePercent) / 100)
    if (config.cumulative) return per * effective
    return per
  }

  // TIERED — sum across tiers covering [tier.streakMin .. min(streak, tier.streakMax)]
  const tiers = config.tiers
    .slice()
    .sort((a, b) => a.streakMin - b.streakMin)
  let sum = 0
  for (const t of tiers) {
    if (t.streakMin > effective) break
    const upper = t.streakMax == null ? effective : Math.min(effective, t.streakMax)
    const count = upper - t.streakMin + 1
    if (count <= 0) continue
    if (t.amount != null) {
      sum += t.amount * count
    } else if (t.percent != null && baseSalary && baseSalary > 0) {
      sum += Math.round((baseSalary * t.percent) / 100) * count
    }
  }
  return Math.round(sum)
}

export function summarizeRule(
  rule: { name: string; config: RuleConfig },
  cleanStreak: number,
  baseSalary?: number,
): string {
  const amount = applyBonusRule(cleanStreak, rule.config, baseSalary ?? null)
  const unit = 'أسابيع'
  const cfg = rule.config
  if (cleanStreak <= 0) return `لا أسابيع نظيفة — 0 ل.س`
  if (cfg.amountType === 'FIXED') {
    const per = cfg.baseAmount ?? 0
    if (cfg.cumulative) {
      return `${cleanStreak} ${unit} × ${per.toLocaleString('en')} = ${amount.toLocaleString('en')} ل.س`
    }
    return `${per.toLocaleString('en')} ل.س (غير تراكمي)`
  }
  if (cfg.amountType === 'PERCENT') {
    if (!baseSalary || baseSalary <= 0) return `يحتاج راتباً أساسياً لاحتساب النسبة`
    const per = Math.round((baseSalary * (cfg.basePercent ?? 0)) / 100)
    if (cfg.cumulative) {
      return `${cleanStreak} ${unit} × ${cfg.basePercent}% (${per.toLocaleString('en')}) = ${amount.toLocaleString('en')} ل.س`
    }
    return `${cfg.basePercent}% من ${baseSalary.toLocaleString('en')} = ${per.toLocaleString('en')} ل.س`
  }
  return `متدرّجة — ${cleanStreak} ${unit} = ${amount.toLocaleString('en')} ل.س`
}

export async function ensureDefaultRuleExists(): Promise<void> {
  const count = await db.bonusRule.count()
  if (count > 0) return
  await db.bonusRule.create({
    data: {
      name: DEFAULT_RULE_NAME,
      description: 'القاعدة الموروثة — 5,000 ل.س لكل أسبوع نظيف، تراكمية',
      interval: 'WEEKLY',
      amountType: 'FIXED',
      baseAmount: 5000,
      cumulative: true,
      isActive: true,
    },
  })
}
