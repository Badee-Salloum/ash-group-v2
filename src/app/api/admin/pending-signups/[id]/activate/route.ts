import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

const activateSchema = z.object({
  role: z.enum(['ADMIN', 'MANAGER', 'SUPERVISOR', 'ACCOUNT_MGR', 'ACCOUNTANT', 'EMPLOYEE']),
  jobTitle: z.string().trim().max(80).optional().or(z.literal('')),
  employeeCode: z.string().trim().max(40).optional().or(z.literal('')),
})

// POST /api/admin/pending-signups/:id/activate
// Activates a pending signup. Optionally assigns role / jobTitle / employeeCode
// in the same call so admin doesn't have to bounce to the employees page.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const body = await req.json()
    const { role, jobTitle, employeeCode } = activateSchema.parse(body)

    const target = await db.user.findUnique({
      where: { id: params.id },
      select: { id: true, isActive: true, name: true },
    })
    if (!target) {
      return NextResponse.json({ success: false, error: 'الحساب غير موجود' }, { status: 404 })
    }
    if (target.isActive) {
      return NextResponse.json({ success: false, error: 'الحساب مُفعَّل بالفعل' }, { status: 400 })
    }

    // Reject duplicate employeeCode upfront with a clear error message.
    if (employeeCode) {
      const dup = await db.user.findUnique({
        where: { employeeCode },
        select: { id: true },
      })
      if (dup && dup.id !== params.id) {
        return NextResponse.json(
          { success: false, error: 'الرقم الوظيفي مستخدم بالفعل' },
          { status: 409 },
        )
      }
    }

    await db.user.update({
      where: { id: params.id },
      data: {
        isActive: true,
        role,
        jobTitle: jobTitle || null,
        employeeCode: employeeCode || null,
      },
      select: { id: true },
    })

    await audit(session.userId, 'USER_ACTIVATED', 'User', params.id, {
      activatedName: target.name,
      assignedRole: role,
    })

    return NextResponse.json({ success: true, message: 'تم تفعيل الحساب' })
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
    console.error('Activate error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ success: false, error: 'خطأ في الخادم' }, { status: 500 })
  }
}
