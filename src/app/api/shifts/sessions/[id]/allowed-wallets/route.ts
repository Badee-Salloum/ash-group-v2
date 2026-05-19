import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { damascusDateStr, damascusDayStartUtc, addDays } from '@/lib/datetime'

// GET /api/shifts/sessions/:id/allowed-wallets
// Returns the wallets that may be picked when editing this session's wallets.
// Mirrors the backend validation logic in /api/shifts/sessions PATCH (edit):
//   1. If the session's user has a scheduled Shift for (date, shiftNumber)
//      with isDayOff=false, returns that Shift's planned wallets (the strict
//      set the backend will accept).
//   2. Otherwise (no schedule for the slot), returns all active accounts so
//      admin/manager can pick any during ad-hoc corrections.
// The session's currently-selected wallets are always included so they don't
// disappear from the UI if the planning later changed.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 })

    const target = await db.shiftSession.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        userId: true,
        shiftNumber: true,
        startAt: true,
        wallets: { select: { accountId: true } },
      },
    })
    if (!target) {
      return NextResponse.json({ success: false, error: 'الجلسة غير موجودة' }, { status: 404 })
    }

    let source: 'schedule' | 'all-active' = 'all-active'
    let allowedIds: string[] = []

    if (target.shiftNumber) {
      const dayKey = damascusDateStr(target.startAt)
      const dayStart = damascusDayStartUtc(dayKey)
      const dayEnd = damascusDayStartUtc(addDays(dayKey, 1))
      const scheduled = await db.shift.findFirst({
        where: {
          userId: target.userId,
          shiftNumber: target.shiftNumber,
          date: { gte: dayStart, lt: dayEnd },
          isDayOff: false,
        },
        include: { wallets: { select: { accountId: true } } },
      })
      if (scheduled) {
        source = 'schedule'
        allowedIds = scheduled.wallets.map((w: { accountId: string }) => w.accountId)
      }
    }

    if (source === 'all-active') {
      const active = await db.account.findMany({
        where: { isActive: true },
        select: { id: true },
        orderBy: { name: 'asc' },
      })
      allowedIds = active.map((a: { id: string }) => a.id)
    }

    // Always include the session's currently-selected wallets so they remain
    // visible in the picker even if planning changed since check-in.
    const currentIds = target.wallets.map((w: { accountId: string }) => w.accountId)
    const merged = Array.from(new Set([...allowedIds, ...currentIds]))

    // Hydrate names + currency for the modal
    const accounts = merged.length === 0 ? [] : await db.account.findMany({
      where: { id: { in: merged } },
      select: { id: true, name: true, currency: true, isActive: true },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({
      success: true,
      source,
      wallets: accounts,
    })
  } catch (e) {
    console.error('GET /api/shifts/sessions/:id/allowed-wallets error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ success: false, error: 'خطأ في الخادم' }, { status: 500 })
  }
}
