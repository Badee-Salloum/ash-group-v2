import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { UserRole } from '@/lib/db/prisma-types'
import { db } from '@/lib/db/client'
import { damascusDateStr, damascusDayStartUtc, addDays } from '@/lib/datetime'
import { checkinWindowUtc, type ShiftNumber } from '@/lib/shifts/shiftWindow'

// Returns the caller's scheduled shift for today (or null). Used by the
// employee shifts page to render the one-click check-in card.
//
// It surfaces the shift whether or not its check-in window is open right now:
//  - a shift whose window is open  → checkinOpen: true
//  - otherwise the next shift today whose window has not opened yet
//    → checkinOpen: false, opensAt set so the card can say when it opens.
//
// Diagnostics: ?debug=1 returns a _debug block with the full resolution.
// ADMIN/MANAGER may add ?userId=<id> to inspect another user's resolution.

export const dynamic = 'force-dynamic'

const WINDOW_LABEL: Record<ShiftNumber, string> = {
  ONE: '06:00 → 14:00',
  TWO: '14:00 → 22:00',
  THREE: '22:00 → 06:00',
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const debug = params.get('debug') === '1'
  const overrideUserId = params.get('userId')
  const isAdminTier = session.role === UserRole.ADMIN || session.role === UserRole.MANAGER
  const targetUserId = overrideUserId && isAdminTier ? overrideUserId : session.userId

  const nowMs = Date.now()
  const today = damascusDateStr(new Date())
  const yesterday = addDays(today, -1)
  const rangeGte = damascusDayStartUtc(yesterday)
  const rangeLt = damascusDayStartUtc(addDays(today, 1))
  const candidates = await db.shift.findMany({
    where: {
      userId: targetUserId,
      isDayOff: false,
      date: { gte: rangeGte, lt: rangeLt },
    },
  })

  type Candidate = (typeof candidates)[number]
  let openShift: Candidate | null = null
  let upcoming: { shift: Candidate; openFromMs: number } | null = null

  for (const c of candidates) {
    const dayKey = damascusDateStr(c.date)
    const w = checkinWindowUtc(dayKey, c.shiftNumber as ShiftNumber)
    const openFromMs = w.openFrom.getTime()
    const endMs = w.end.getTime()
    if (nowMs >= openFromMs && nowMs <= endMs) {
      openShift = c
      break
    }
    if (nowMs < openFromMs && (!upcoming || openFromMs < upcoming.openFromMs)) {
      upcoming = { shift: c, openFromMs }
    }
  }

  const picked = openShift ?? upcoming?.shift ?? null

  const debugInfo = debug
    ? {
        serverNow: new Date(nowMs).toISOString(),
        today,
        yesterday,
        rangeGte: rangeGte.toISOString(),
        rangeLt: rangeLt.toISOString(),
        targetUserId,
        sessionUserId: session.userId,
        candidateCount: candidates.length,
        candidates: candidates.map((c: Candidate) => {
          const dayKey = damascusDateStr(c.date)
          const w = checkinWindowUtc(dayKey, c.shiftNumber as ShiftNumber)
          return {
            id: c.id,
            date: c.date,
            shiftNumber: c.shiftNumber,
            isDayOff: c.isDayOff,
            dayKey,
            openFrom: w.openFrom.toISOString(),
            end: w.end.toISOString(),
            isOpen: nowMs >= w.openFrom.getTime() && nowMs <= w.end.getTime(),
          }
        }),
        pickedId: picked?.id ?? null,
        openShiftFound: openShift !== null,
      }
    : undefined

  if (!picked) {
    return NextResponse.json({ success: true, scheduled: null, ...(debug ? { _debug: debugInfo } : {}) })
  }

  const handoverNames = picked.handoverFromUserIds.length > 0
    ? (await db.user.findMany({
        where: { id: { in: picked.handoverFromUserIds } },
        select: { name: true },
      })).map((u: { name: string }) => u.name)
    : []

  return NextResponse.json({
    success: true,
    scheduled: {
      shiftNumber: picked.shiftNumber,
      windowLabel: WINDOW_LABEL[picked.shiftNumber as ShiftNumber],
      handoverNames,
      checkinOpen: openShift !== null,
      opensAt: openShift ? null : new Date(upcoming!.openFromMs).toISOString(),
    },
    ...(debug ? { _debug: debugInfo } : {}),
  })
}
