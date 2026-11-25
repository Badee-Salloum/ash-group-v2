// Phase G — per-user permission overrides (admin only).

import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { getEffectivePermissions } from '@/lib/permissions/overrides'
import { z } from 'zod'

const postSchema = z.object({
  userId: z.string().min(1),
  permissionKey: z.string().min(1),
  isAllowed: z.boolean(),
  reason: z.string().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const userId = req.nextUrl.searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'userId مطلوب' }, { status: 400 })

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    })
    if (!user) return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 })

    const overrides = await db.permissionOverride.findMany({
      where: { userId },
      select: { permissionKey: true, isAllowed: true, reason: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })

    const effective = await getEffectivePermissions(userId, user.role as UserRole)

    return NextResponse.json({ success: true, overrides, effective })
  } catch (error) {
    if (String(error) === 'Error: FORBIDDEN') {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const data = postSchema.parse(await req.json())

    const row = await db.permissionOverride.upsert({
      where: { userId_permissionKey: { userId: data.userId, permissionKey: data.permissionKey } },
      create: {
        userId: data.userId,
        permissionKey: data.permissionKey,
        isAllowed: data.isAllowed,
        reason: data.reason,
      },
      update: {
        isAllowed: data.isAllowed,
        reason: data.reason,
      },
    })

    await audit(session.userId, 'UPSERT_PERMISSION_OVERRIDE', 'User', data.userId, {
      permissionKey: data.permissionKey,
      isAllowed: data.isAllowed,
      reason: data.reason,
    })

    return NextResponse.json({ success: true, id: row.id })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    if (String(error) === 'Error: FORBIDDEN') {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const userId = req.nextUrl.searchParams.get('userId')
    const permissionKey = req.nextUrl.searchParams.get('permissionKey')
    if (!userId || !permissionKey) {
      return NextResponse.json({ error: 'userId و permissionKey مطلوبان' }, { status: 400 })
    }

    await db.permissionOverride.delete({
      where: { userId_permissionKey: { userId, permissionKey } },
    }).catch(() => null)

    await audit(session.userId, 'REVOKE_PERMISSION_OVERRIDE', 'User', userId, { permissionKey })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (String(error) === 'Error: FORBIDDEN') {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
