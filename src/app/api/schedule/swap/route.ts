import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

// POST /api/schedule/swap
// Body: { shiftAId, shiftBId }
//
// Admin / Branch Manager swaps the assignees of two scheduled shifts. The
// shifts' wallets stay with the shift slot — the swap moves *who covers* each
// slot, not the planned work for the slot.
//
// Pre-checks reject swaps that would violate the (date, shiftNumber, userId)
// uniqueness constraint (i.e. one of the new users already has another shift
// in that slot). The swap itself is a single UPDATE with CASE so postgres
// checks the unique constraint at statement end (after both rows are written).
const bodySchema = z.object({
  shiftAId: z.string().min(1),
  shiftBId: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const body = await req.json()
    const { shiftAId, shiftBId } = bodySchema.parse(body)

    if (shiftAId === shiftBId) {
      return NextResponse.json({ success: false, error: 'لا يمكن تبديل المناوبة مع نفسها' }, { status: 400 })
    }

    const shifts = await db.shift.findMany({
      where: { id: { in: [shiftAId, shiftBId] } },
      include: {
        user: { select: { id: true, name: true } },
      },
    })
    if (shifts.length !== 2) {
      return NextResponse.json({ success: false, error: 'إحدى المناوبتين غير موجودة' }, { status: 404 })
    }
    const a = shifts.find((s: typeof shifts[0]) => s.id === shiftAId)!
    const b = shifts.find((s: typeof shifts[0]) => s.id === shiftBId)!

    if (a.userId === b.userId) {
      return NextResponse.json({
        success: false,
        error: 'الموظف نفسه يشغل المناوبتين — لا يوجد تبديل ممكن',
      }, { status: 400 })
    }

    // Conflict check: would the swap collide with another existing shift?
    const [conflictA, conflictB] = await Promise.all([
      db.shift.findFirst({
        where: {
          date: a.date,
          shiftNumber: a.shiftNumber,
          userId: b.userId,
          id: { notIn: [a.id, b.id] },
        },
        select: { id: true },
      }),
      db.shift.findFirst({
        where: {
          date: b.date,
          shiftNumber: b.shiftNumber,
          userId: a.userId,
          id: { notIn: [a.id, b.id] },
        },
        select: { id: true },
      }),
    ])
    if (conflictA || conflictB) {
      return NextResponse.json({
        success: false,
        error: 'لا يمكن التبديل — أحد الموظفَين له مناوبة أخرى في نفس الفترة',
      }, { status: 409 })
    }

    // Atomic swap. Postgres checks unique constraints at statement end, so a
    // single UPDATE with CASE swaps both userIds without tripping the
    // (date, shiftNumber, userId) uniqueness mid-statement.
    await db.$executeRaw(Prisma.sql`
      UPDATE "shifts"
      SET "userId" = CASE
        WHEN "id" = ${a.id} THEN ${b.userId}::text
        WHEN "id" = ${b.id} THEN ${a.userId}::text
        ELSE "userId"
      END
      WHERE "id" IN (${a.id}, ${b.id})
    `)

    await audit(session.userId, 'SWAP_SHIFTS', 'Shift', a.id, {
      shiftAId: a.id,
      shiftBId: b.id,
      fromUserA: a.user.name,
      fromUserB: b.user.name,
      dateA: a.date,
      dateB: b.date,
      shiftA: a.shiftNumber,
      shiftB: b.shiftNumber,
    })

    return NextResponse.json({
      success: true,
      message: `تم تبديل المناوبتين: ${a.user.name} ↔ ${b.user.name}`,
    })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: e.issues[0]?.message || 'بيانات غير صالحة' },
        { status: 400 },
      )
    }
    if (e instanceof Error && e.message === 'FORBIDDEN') {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 })
    }
    console.error('Swap shifts error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ success: false, error: 'خطأ في الخادم' }, { status: 500 })
  }
}
