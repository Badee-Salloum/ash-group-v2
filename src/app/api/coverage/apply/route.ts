// Phase F — bulk-apply coverage entries for a specific week.
//
// Deletes any existing CoverageAssignment rows for the target week first,
// then inserts the new set in a single transaction so a half-applied state
// can never be observed.

import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { addDays, dateColumnUtc } from '@/lib/datetime'
import { z } from 'zod'

const entrySchema = z.object({
  userId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  originalShiftId: z.string().optional().nullable(),
  coverForUserId: z.string().optional().nullable(),
})

const bodySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(entrySchema),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const data = bodySchema.parse(await req.json())
    const weekEnd = addDays(data.weekStart, 6)

    // Wrap the wipe + insert in a single transaction so the table is never
    // observed in a half-applied state.
    const inserted = await db.$transaction(async (tx: typeof db) => {
      await tx.coverageAssignment.deleteMany({
        where: {
          date: { gte: dateColumnUtc(data.weekStart), lte: dateColumnUtc(weekEnd) },
        },
      })
      if (data.entries.length === 0) return 0
      const result = await tx.coverageAssignment.createMany({
        data: data.entries.map(e => ({
          userId: e.userId,
          date: dateColumnUtc(e.date),
          startTime: e.startTime,
          endTime: e.endTime,
          originalShiftId: e.originalShiftId ?? null,
          coverForUserId: e.coverForUserId ?? null,
        })),
        skipDuplicates: true,
      })
      return result.count
    })

    await audit(session.userId, 'APPLY_COVERAGE', 'CoverageAssignment', null as unknown as string, {
      weekStart: data.weekStart, count: inserted,
    })
    return NextResponse.json({ success: true, count: inserted })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    const msg = error instanceof Error ? error.message : String(error)
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
