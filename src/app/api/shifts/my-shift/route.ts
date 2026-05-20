import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
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
// This way an employee who is scheduled always sees their shift instead of a
// misleading "no shift" message just because they looked early.

const WINDOW_LABEL: Record<ShiftNumber, string> = {
  ONE: '06:00 → 14:00',
  TWO: '14:00 → 22:00',
  THREE: '22:00 → 06:00',
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const nowMs = Date.now()
  const today = damascusDateStr(new Date())
  const yesterday = addDays(today, -1)
  const candidates = await db.shift.findMany({
    where: {
      userId: session.userId,
      isDayOff: false,
      date: {
        gte: damascusDayStartUtc(yesterday),
        lt: damascusDayStartUtc(addDays(today, 2)),
      },
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
  if (!picked) {
    return NextResponse.json({ success: true, scheduled: null })
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
  })
}
