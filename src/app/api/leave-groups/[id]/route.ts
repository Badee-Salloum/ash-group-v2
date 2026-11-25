import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { z } from 'zod'

const MAX_MEMBERS = 6

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  coverUserId: z.string().nullable().optional(),
  memberIds: z.array(z.string()).max(MAX_MEMBERS).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const data = patchSchema.parse(await req.json())
    const existing = await db.leaveGroup.findUnique({ where: { id: params.id }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: 'المجموعة غير موجودة' }, { status: 404 })

    await db.$transaction(async (tx: typeof db) => {
      // Cover must not also be a member.
      if (data.coverUserId && data.memberIds?.includes(data.coverUserId)) {
        throw new Error('المغطّي لا يمكن أن يكون عضواً في المجموعة نفسها')
      }
      await tx.leaveGroup.update({
        where: { id: params.id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.coverUserId !== undefined ? { coverUserId: data.coverUserId } : {}),
        },
      })
      if (data.memberIds) {
        // Detach anyone currently in the group who is NOT in the new list.
        await tx.user.updateMany({
          where: { leaveGroupId: params.id, id: { notIn: data.memberIds } },
          data: { leaveGroupId: null },
        })
        // Attach the newcomers (idempotent — already-members stay).
        if (data.memberIds.length > 0) {
          await tx.user.updateMany({
            where: { id: { in: data.memberIds } },
            data: { leaveGroupId: params.id },
          })
        }
      }
    })
    await audit(session.userId, 'UPDATE_LEAVE_GROUP', 'LeaveGroup', params.id, data as Record<string, unknown>)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const existing = await db.leaveGroup.findUnique({ where: { id: params.id }, select: { id: true, name: true } })
    if (!existing) return NextResponse.json({ error: 'المجموعة غير موجودة' }, { status: 404 })

    await db.$transaction(async (tx: typeof db) => {
      await tx.user.updateMany({ where: { leaveGroupId: params.id }, data: { leaveGroupId: null } })
      await tx.leaveGroup.delete({ where: { id: params.id } })
    })
    await audit(session.userId, 'DELETE_LEAVE_GROUP', 'LeaveGroup', params.id, { name: existing.name })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
