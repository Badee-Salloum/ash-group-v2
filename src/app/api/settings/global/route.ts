import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { UserRole } from '@/lib/db/prisma-types'
import {
  getDefaultWeeklyOffDays,
  setDefaultWeeklyOffDays,
  getPayrollEpochStart,
  setPayrollEpochStart,
  getBonusThresholds,
  setBonusThresholds,
} from '@/lib/settings/global'

// GET — any authenticated user can read (used by payroll display); PUT allows
// ADMIN and MANAGER (bonus thresholds fall under the branch-manager's remit).
export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    const [defaultWeeklyOffDays, payrollEpochStart, bonusThresholds] = await Promise.all([
      getDefaultWeeklyOffDays(),
      getPayrollEpochStart(),
      getBonusThresholds(),
    ])
    return NextResponse.json({
      success: true,
      data: { defaultWeeklyOffDays, payrollEpochStart, bonusThresholds },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const body = await req.json()
    const {
      defaultWeeklyOffDays,
      payrollEpochStart,
      bonusThresholds,
    } = body as {
      defaultWeeklyOffDays?: number
      payrollEpochStart?: string
      bonusThresholds?: { ratioLimit?: number; amountLimits?: Record<string, number>; delayLimit?: number }
    }

    let touched = false
    if (typeof defaultWeeklyOffDays === 'number') {
      await setDefaultWeeklyOffDays(defaultWeeklyOffDays, session.userId)
      await audit(session.userId, 'UPDATE_SETTING', 'SystemSetting', 'default_weekly_off_days', { defaultWeeklyOffDays })
      touched = true
    }
    if (typeof payrollEpochStart === 'string' && payrollEpochStart.length > 0) {
      await setPayrollEpochStart(payrollEpochStart, session.userId)
      await audit(session.userId, 'UPDATE_SETTING', 'SystemSetting', 'payroll_epoch_start', { payrollEpochStart })
      touched = true
    }
    if (bonusThresholds && typeof bonusThresholds === 'object') {
      await setBonusThresholds(bonusThresholds, session.userId)
      await audit(session.userId, 'UPDATE_SETTING', 'SystemSetting', 'bonus_thresholds', bonusThresholds)
      touched = true
    }
    if (!touched) {
      return NextResponse.json({ error: 'لا توجد قيمة لتحديثها' }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
