import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { generateWeeklySchedule, type Employee as GenEmployee } from '@/lib/schedule/generator'
import { z } from 'zod'

// Module E — Shift scheduling.
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD → list scheduled shifts in range
// POST → bulk create/replace shifts for a week
// PATCH { id, isDayOff?, userId? } → update single
// DELETE ?id=... → remove
// POST ?action=suggest&from=...&minPerShift=... → returns suggestion (no DB writes)

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const from = params.get('from') ? new Date(params.get('from')!) : new Date()
  const to = params.get('to') ? new Date(params.get('to')!) : new Date(Date.now() + 7 * 86400000)

  const shifts = await db.shift.findMany({
    where: { date: { gte: from, lte: to } },
    include: { user: { select: { id: true, name: true, jobTitle: true, avatarUrl: true } } },
    orderBy: [{ date: 'asc' }, { shiftNumber: 'asc' }],
  })

  return NextResponse.json({ success: true, data: shifts })
}

const upsertSchema = z.object({
  shifts: z.array(z.object({
    date: z.string(),
    shiftNumber: z.enum(['ONE', 'TWO', 'THREE']),
    userId: z.string(),
    isDayOff: z.boolean().optional(),
    notes: z.string().optional(),
  })),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const action = req.nextUrl.searchParams.get('action')
    if (action === 'suggest') {
      return suggestSchedule(req)
    }

    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])
    const body = await req.json()
    const data = upsertSchema.parse(body)

    // Determine date range covered to delete-then-recreate (idempotent week save)
    const dates = data.shifts.map((s: typeof data.shifts[0]) => new Date(s.date))
    if (dates.length === 0) {
      return NextResponse.json({ success: true, count: 0 })
    }
    const minDate = new Date(Math.min(...dates.map((d: Date) => d.getTime())))
    const maxDate = new Date(Math.max(...dates.map((d: Date) => d.getTime())))

    await db.$transaction([
      db.shift.deleteMany({
        where: { date: { gte: minDate, lte: maxDate } },
      }),
      db.shift.createMany({
        data: data.shifts.map((s: typeof data.shifts[0]) => ({
          date: new Date(s.date),
          shiftNumber: s.shiftNumber,
          userId: s.userId,
          assignedById: session.userId,
          isDayOff: !!s.isDayOff,
          notes: s.notes,
        })),
        skipDuplicates: true,
      }),
    ])

    await audit(session.userId, 'SAVE_SCHEDULE', 'Shift', null as unknown as string, {
      count: data.shifts.length,
      from: minDate, to: maxDate,
    })
    return NextResponse.json({ success: true, count: data.shifts.length })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

// Auto-suggestion: delegate to the pure generator in src/lib/schedule. Only
// front-line `EMPLOYEE`s are scheduled — managers/supervisors/account managers
// are exempt from shift rotation by policy. Each employee is pinned to one
// shift number for the week (continuity) and their `weeklyOffDays` are
// rotated across the team so different people are off on different days.
async function suggestSchedule(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const from = params.get('from') ? new Date(params.get('from')!) : new Date()
  const minPerShift = Math.max(1, parseInt(params.get('minPerShift') || '1'))
  const defaultOffDays = Math.max(0, Math.min(3, parseInt(params.get('defaultOffDays') || '1')))

  const employees = await db.user.findMany({
    where: { isActive: true, role: 'EMPLOYEE' },
    select: { id: true, name: true, jobTitle: true, weeklyOffDays: true },
  })

  const genInput: GenEmployee[] = employees.map((e: { id: string; weeklyOffDays: number | null }) => ({
    id: e.id,
    weeklyOffDays: e.weeklyOffDays ?? defaultOffDays,
  }))

  const result = generateWeeklySchedule({
    weekStart: from,
    employees: genInput,
    minPerShift,
  })

  return NextResponse.json({
    success: true,
    data: result.shifts,
    assignments: result.assignments,
    employees: employees.length,
  })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id مطلوب' }, { status: 400 })
  await db.shift.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
