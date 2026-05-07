import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

// POST /api/admin/pending-signups/:id/reject
// Permanently deletes a pending (inactive) signup. Cannot delete an active
// account through this endpoint — admin must use the employees page for that.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const target = await db.user.findUnique({
      where: { id: params.id },
      select: { id: true, isActive: true, name: true, email: true },
    })
    if (!target) {
      return NextResponse.json({ success: false, error: 'الحساب غير موجود' }, { status: 404 })
    }
    if (target.isActive) {
      return NextResponse.json(
        { success: false, error: 'لا يمكن رفض حساب مُفعَّل من هنا' },
        { status: 400 },
      )
    }

    await db.user.delete({ where: { id: params.id } })

    await audit(session.userId, 'SIGNUP_REJECTED', 'User', params.id, {
      rejectedName: target.name,
      rejectedEmail: target.email,
    })

    return NextResponse.json({ success: true, message: 'تم رفض الطلب وحذف الحساب' })
  } catch (e) {
    if (e instanceof Error && e.message === 'FORBIDDEN') {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 })
    }
    console.error('Reject error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ success: false, error: 'خطأ في الخادم' }, { status: 500 })
  }
}
