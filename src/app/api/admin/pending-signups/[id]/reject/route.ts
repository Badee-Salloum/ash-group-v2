import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

// Maps an FK constraint name (from Prisma P2003) to a human-readable Arabic
// description of what's blocking the delete.
const FK_HINTS: Record<string, string> = {
  shifts_userId_fkey: 'مناوبات مجدولة',
  shift_sessions_userId_fkey: 'جلسات دوام',
  shift_sessions_approvedById_fkey: 'جلسات اعتمدها',
  payroll_entries_userId_fkey: 'سجلات رواتب',
  advance_requests_userId_fkey: 'طلبات سلف',
  advance_requests_approvedById_fkey: 'طلبات سلف اعتمدها',
  bonus_logs_userId_fkey: 'مكافآت مستلَمة',
  bonus_logs_createdById_fkey: 'مكافآت أنشأها',
  expenses_userId_fkey: 'صرفيات',
  upload_batches_uploadedBy_fkey: 'دفعات رفع',
  audit_logs_userId_fkey: 'سجلات تدقيق',
  transactions_handledByUserId_fkey: 'عمليات معالَجة',
  transactions_followUpAssignedTo_fkey: 'متابعات مُسنَدة',
  shifts_assignedById_fkey: 'مناوبات أسندها',
}

// POST /api/admin/pending-signups/:id/reject
// Permanently deletes a pending (inactive) signup. Cannot delete an active
// account through this endpoint — admin must use the employees page for that.
//
// A "pending" signup should normally have no related rows, but the admin may
// have pre-assigned shifts before activation. We clean up those benign
// relations in a transaction; anything heavier surfaces a descriptive 409.
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

    try {
      await db.$transaction([
        // Scheduled shifts the admin may have pre-assigned to this pending account
        db.shift.deleteMany({ where: { userId: params.id } }),
        // Nullify references where this user appears as the assigner (nullable FK)
        db.shift.updateMany({
          where: { assignedById: params.id },
          data: { assignedById: null },
        }),
        db.user.delete({ where: { id: params.id } }),
      ])
    } catch (deleteErr) {
      if (deleteErr instanceof Prisma.PrismaClientKnownRequestError && deleteErr.code === 'P2003') {
        const meta = deleteErr.meta as { field_name?: string; constraint?: string } | undefined
        const raw = meta?.constraint || meta?.field_name || ''
        const key = String(raw).split(' ')[0]  // e.g. "shifts_userId_fkey (index)" → "shifts_userId_fkey"
        const hint = FK_HINTS[key] || 'بيانات مرتبطة'
        return NextResponse.json({
          success: false,
          error: `لا يمكن حذف الحساب — مرتبط بـ${hint}. احذفها أولاً أو استخدم تعطيل الحساب بدلاً من الحذف.`,
        }, { status: 409 })
      }
      throw deleteErr
    }

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
