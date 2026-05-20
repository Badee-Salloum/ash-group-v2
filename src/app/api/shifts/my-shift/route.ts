import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { damascusDateStr, damascusDayStartUtc, addDays } from '@/lib/datetime'
import { checkinWindowUtc, type ShiftNumber } from '@/lib/shifts/shiftWindow'

// Returns the caller's scheduled shift whose check-in window is open right
// now (or null). Used by the employee shifts page to render the one-click
// check-in card without exposing the whole roster.

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
        lt: damascusDayStartUtc(addDays(today, 1)),
      },
    },
  })

  let scheduled: (typeof candidates)[number] | null = null
  for (const c of candidates) {
    const dayKey = damascusDateStr(c.date)
    const w = checkinWindowUtc(dayKey, c.shiftNumber as ShiftNumber)
    if (nowMs >= w.openFrom.getTime() && nowMs <= w.end.getTime()) {
      scheduled = c
      break
    }
  }

  if (!scheduled) {
    return NextResponse.json({ success: true, scheduled: null })
  }

  const handoverNames = scheduled.handoverFromUserIds.length > 0
    ? (await db.user.findMany({
        where: { id: { in: scheduled.handoverFromUserIds } },
        select: { name: true },
      })).map((u: { name: string }) => u.name)
    : []

  return NextResponse.json({
    success: true,
    scheduled: {
      shiftNumber: scheduled.shiftNumber,
      windowLabel: WINDOW_LABEL[scheduled.shiftNumber as ShiftNumber],
      handoverNames,
    },
  })
}
