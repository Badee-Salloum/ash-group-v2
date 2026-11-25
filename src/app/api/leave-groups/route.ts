import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { z } from 'zod'

// Leave groups — manager-defined groupings inside each shift (ONE/TWO/THREE).
// A group has up to 6 members and exactly one cover ("spare") employee who
// takes over the group's work on any member's fixed weekly off-day.

const MAX_MEMBERS = 6

const shiftNumberEnum = z.enum(['ONE', 'TWO', 'THREE'])

const createSchema = z.object({
  name: z.string().trim().min(1, 'الاسم مطلوب').max(60),
  shiftNumber: shiftNumberEnum,
  coverUserId: z.string().nullable().optional(),
  memberIds: z.array(z.string()).max(MAX_MEMBERS, `السقف ${MAX_MEMBERS} أعضاء`).optional(),
})

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPERVISOR])

    const shift = req.nextUrl.searchParams.get('shiftNumber')
    const where: Record<string, unknown> = {}
    if (shift && ['ONE', 'TWO', 'THREE'].includes(shift)) where.shiftNumber = shift

    const groups = await db.leaveGroup.findMany({
      where,
      include: {
        members: {
          select: { id: true, name: true, employeeCode: true, weeklyOffDay: true },
          orderBy: { name: 'asc' },
        },
        coverUser: { select: { id: true, name: true, employeeCode: true } },
      },
      orderBy: [{ shiftNumber: 'asc' }, { name: 'asc' }],
    })
    return NextResponse.json({ success: true, data: groups })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const data = createSchema.parse(await req.json())

    // Create the group; hand members in only if provided.
    const created = await db.$transaction(async (tx: typeof db) => {
      const g = await tx.leaveGroup.create({
        data: {
          name: data.name,
          shiftNumber: data.shiftNumber,
          coverUserId: data.coverUserId ?? null,
        },
        select: { id: true },
      })
      if (data.memberIds && data.memberIds.length > 0) {
        // Reject if any of the requested members is already the cover.
        if (data.coverUserId && data.memberIds.includes(data.coverUserId)) {
          throw new Error('المغطّي لا يمكن أن يكون عضواً في المجموعة نفسها')
        }
        await tx.user.updateMany({
          where: { id: { in: data.memberIds } },
          data: { leaveGroupId: g.id },
        })
      }
      return g
    })
    await audit(session.userId, 'CREATE_LEAVE_GROUP', 'LeaveGroup', created.id, { name: data.name, shiftNumber: data.shiftNumber })
    return NextResponse.json({ success: true, id: created.id })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
