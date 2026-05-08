import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

// PATCH /api/follow-ups/:id
// Updates a follow-up: status, assignee, resolution notes.
// RBAC: ADMIN / SUPERVISOR / ACCOUNT_MGR / ACCOUNTANT can update any.
//        Other roles can update only their own (when they're the current assignee).
const FULL_ACCESS_ROLES: string[] = [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.ACCOUNT_MGR, 'ACCOUNTANT']

const patchSchema = z.object({
  followUpStatus: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  // empty string clears the assignee; otherwise expects a valid userId
  followUpAssignedTo: z.string().optional(),
  followUpResolution: z.string().max(2000).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 })

    const body = await req.json()
    const data = patchSchema.parse(body)

    const existing = await db.transaction.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        accountId: true,
        followUpStatus: true,
        followUpAssignedTo: true,
        followUpResolution: true,
        followUpResolvedAt: true,
        followUpResolvedBy: true,
        reviewCategory: true,
      },
    })
    if (!existing) {
      return NextResponse.json({ success: false, error: 'العملية غير موجودة' }, { status: 404 })
    }
    if (!existing.followUpStatus) {
      return NextResponse.json({ success: false, error: 'لا توجد متابعة على هذه العملية' }, { status: 400 })
    }

    // Authorization
    const isPrivileged = FULL_ACCESS_ROLES.includes(session.role)
    const isCurrentAssignee = existing.followUpAssignedTo === session.userId
    if (!isPrivileged && !isCurrentAssignee) {
      return NextResponse.json({ success: false, error: 'غير مصرح بتعديل هذه المتابعة' }, { status: 403 })
    }

    // ACCOUNT_MGR can only touch their own accounts
    if (session.role === UserRole.ACCOUNT_MGR) {
      const hasAccess = await db.accountAccess.findUnique({
        where: { userId_accountId: { userId: session.userId, accountId: existing.accountId } },
      })
      if (!hasAccess) {
        return NextResponse.json({ success: false, error: 'لا تملك صلاحية على هذا الحساب' }, { status: 403 })
      }
    }

    // Validate assignee exists if provided as a non-empty userId
    if (data.followUpAssignedTo && data.followUpAssignedTo.length > 0) {
      const u = await db.user.findUnique({
        where: { id: data.followUpAssignedTo },
        select: { id: true, isActive: true },
      })
      if (!u) {
        return NextResponse.json({ success: false, error: 'المستخدم المُعيَّن غير موجود' }, { status: 400 })
      }
      if (!u.isActive) {
        return NextResponse.json({ success: false, error: 'المستخدم المُعيَّن غير مُفعَّل' }, { status: 400 })
      }
    }

    // Build update payload
    const update: Record<string, unknown> = {}
    if (data.followUpStatus !== undefined) update.followUpStatus = data.followUpStatus
    if (data.followUpAssignedTo !== undefined) {
      update.followUpAssignedTo = data.followUpAssignedTo === '' ? null : data.followUpAssignedTo
    }
    if (data.followUpResolution !== undefined) update.followUpResolution = data.followUpResolution

    // Resolve metadata: stamp on transition INTO RESOLVED/CLOSED, clear when leaving
    const newStatus = data.followUpStatus
    const isClosingNow = newStatus === 'RESOLVED' || newStatus === 'CLOSED'
    const wasClosed = existing.followUpStatus === 'RESOLVED' || existing.followUpStatus === 'CLOSED'
    if (isClosingNow && !wasClosed) {
      update.followUpResolvedAt = new Date()
      update.followUpResolvedBy = session.userId
    } else if (newStatus && !isClosingNow && wasClosed) {
      // Re-opening — clear stamp
      update.followUpResolvedAt = null
      update.followUpResolvedBy = null
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ success: false, error: 'لم يتم تحديد أي تغيير' }, { status: 400 })
    }

    const updated = await db.transaction.update({
      where: { id: params.id },
      data: update,
      include: {
        followUpAssignee: { select: { id: true, name: true } },
        account: { select: { name: true } },
      },
    })

    await audit(session.userId, 'FOLLOWUP_TRANSITION', 'Transaction', params.id, {
      before: {
        followUpStatus: existing.followUpStatus,
        followUpAssignedTo: existing.followUpAssignedTo,
        followUpResolution: existing.followUpResolution,
      },
      after: update,
    })

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        followUpStatus: updated.followUpStatus,
        followUpAssignedTo: updated.followUpAssignedTo,
        followUpAssigneeName: updated.followUpAssignee?.name ?? null,
        followUpResolution: updated.followUpResolution,
        followUpResolvedAt: updated.followUpResolvedAt?.toISOString() ?? null,
      },
    })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: e.issues[0]?.message || 'بيانات غير صالحة' },
        { status: 400 },
      )
    }
    console.error('PATCH /api/follow-ups/:id error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ success: false, error: 'خطأ في الخادم' }, { status: 500 })
  }
}
