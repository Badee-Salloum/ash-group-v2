import { NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

// GET /api/admin/pending-signups
// Returns users created via /signup who are still inactive and awaiting
// administrator activation. Only ADMIN can list.
export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const users = await db.user.findMany({
      where: { isActive: false },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ success: true, data: users })
  } catch (e) {
    const status = e instanceof Error && e.message === 'FORBIDDEN' ? 403 : 500
    return NextResponse.json(
      { success: false, error: status === 403 ? 'غير مصرح' : 'خطأ في الخادم' },
      { status },
    )
  }
}
