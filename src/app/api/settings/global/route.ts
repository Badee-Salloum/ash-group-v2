import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { UserRole } from '@/lib/db/prisma-types'
import { getDefaultWeeklyOffDays, setDefaultWeeklyOffDays } from '@/lib/settings/global'

// GET — any authenticated user can read (used by payroll display); ADMIN-only PUT.
export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    const defaultWeeklyOffDays = await getDefaultWeeklyOffDays()
    return NextResponse.json({ success: true, data: { defaultWeeklyOffDays } })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const body = await req.json()
    const { defaultWeeklyOffDays } = body
    if (typeof defaultWeeklyOffDays !== 'number') {
      return NextResponse.json({ error: 'defaultWeeklyOffDays مطلوب' }, { status: 400 })
    }
    await setDefaultWeeklyOffDays(defaultWeeklyOffDays, session.userId)
    await audit(session.userId, 'UPDATE_SETTING', 'SystemSetting', 'default_weekly_off_days', { defaultWeeklyOffDays })
    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
