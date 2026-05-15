import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { tryAutoApproveHandover } from '@/lib/shifts/autoApprove'
import { z } from 'zod'

// Module B: Shift sessions (Check-in/Check-out + handover).
//
// GET    → list sessions (?userId=me|<id>, ?status=ACTIVE|PENDING_END|...)
// POST   → request check-in (creates ACTIVE or PENDING_START session)
// PATCH  → request check-out OR approve a handover (manual fallback)
//
// Handover flow (per SRS, with v3 auto-approval layer):
//   1. Outgoing employee posts PATCH { action: 'requestEnd', sessionId }
//      → status changes to PENDING_END
//   2. Incoming employee posts POST { handoverFromUserId, walletIds[], shiftNumber }
//      → creates a session with status PENDING_START referencing the outgoing
//      → AUTO-APPROVAL is attempted immediately:
//          • Outgoing session must be PENDING_END for handoverFromUserId
//          • Incoming wallet set must EXACTLY match outgoing wallet set
//          • Incoming employee must be scheduled on the Shift table for
//            today's date + shiftNumber (and not marked isDayOff)
//        If all three pass → status flips to ACTIVE silently and outgoing
//        is closed. approvedById stays NULL with a note "auto-approved".
//        Otherwise the session stays PENDING_START for manual approval.
//   3. (Manual fallback) Manager/Supervisor posts PATCH
//      { action: 'approveHandover', sessionId } → same flip as auto.

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const userIdRaw = params.get('userId')
  const userId = userIdRaw === 'me' ? session.userId : userIdRaw
  const status = params.get('status') || undefined

  const where: Record<string, unknown> = {}
  if (userId) where.userId = userId
  if (status) where.status = status

  const sessions = await db.shiftSession.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, jobTitle: true, employeeCode: true, avatarUrl: true } },
      approvedBy: { select: { id: true, name: true } },
      wallets: true,
    },
    orderBy: { startAt: 'desc' },
    take: 200,
  })

  return NextResponse.json({ success: true, data: sessions })
}

const checkinSchema = z.object({
  shiftNumber: z.enum(['ONE', 'TWO', 'THREE']).optional(),
  walletIds: z.array(z.string()).default([]),
  handoverFromUserId: z.string().optional(),
  notes: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const body = await req.json()
    const data = checkinSchema.parse(body)

    // If handover requested, the previous (outgoing) session must already be in PENDING_END
    let initialStatus: 'ACTIVE' | 'PENDING_START' = 'ACTIVE'
    if (data.handoverFromUserId) {
      const outgoing = await db.shiftSession.findFirst({
        where: {
          userId: data.handoverFromUserId,
          status: { in: ['ACTIVE', 'PENDING_END'] },
        },
        orderBy: { startAt: 'desc' },
      })
      if (!outgoing) {
        return NextResponse.json({
          error: 'لا توجد جلسة نشطة للموظف السابق. اطلب منه تسجيل خروج أولاً.',
        }, { status: 400 })
      }
      // Auto-set outgoing to PENDING_END only if still ACTIVE.
      // updateMany() with a status guard prevents two concurrent handovers
      // from both flipping the same outgoing session.
      if (outgoing.status === 'ACTIVE') {
        const flipped = await db.shiftSession.updateMany({
          where: { id: outgoing.id, status: 'ACTIVE' },
          data: { status: 'PENDING_END' },
        })
        if (flipped.count === 0) {
          return NextResponse.json({
            error: 'الجلسة السابقة قيد التسليم بالفعل. حاول مجدداً.',
          }, { status: 409 })
        }
      }
      initialStatus = 'PENDING_START'
    } else {
      // Without handover: ensure no other active session for this user
      const existing = await db.shiftSession.findFirst({
        where: { userId: session.userId, status: { in: ['ACTIVE', 'PENDING_END', 'PENDING_START'] } },
      })
      if (existing) {
        return NextResponse.json({
          error: 'لديك جلسة نشطة بالفعل. سجّل خروج منها أولاً.',
        }, { status: 400 })
      }
    }

    // Validate wallet ids belong to employee's allowed list
    if (data.walletIds.length > 0) {
      const allowed = await db.employeeWalletAssignment.findMany({
        where: { userId: session.userId, accountId: { in: data.walletIds } },
        select: { accountId: true },
      })
      const allowedIds = new Set(allowed.map((a: typeof allowed[0]) => a.accountId))
      const invalid = data.walletIds.filter((id: string) => !allowedIds.has(id))
      if (invalid.length > 0) {
        return NextResponse.json({
          error: `غير مسموح بالعمل على ${invalid.length} محفظة من المختارة.`,
        }, { status: 400 })
      }
    }

    const created = await db.shiftSession.create({
      data: {
        userId: session.userId,
        shiftNumber: data.shiftNumber,
        status: initialStatus,
        handoverFromUserId: data.handoverFromUserId,
        notes: data.notes,
        wallets: {
          create: data.walletIds.map(accountId => ({ accountId })),
        },
      },
    })

    await audit(session.userId, 'CHECK_IN', 'ShiftSession', created.id, {
      shiftNumber: data.shiftNumber,
      walletCount: data.walletIds.length,
      handover: !!data.handoverFromUserId,
    })

    // Attempt auto-approval for handovers. If the outgoing employee hasn't
    // requested end yet this returns { approved: false, reason: "في انتظار…" }
    // — the session stays PENDING_START until the outgoing-side trigger fires
    // from PATCH requestEnd (see below).
    let autoApproved = false
    let autoReason: string | undefined
    let finalStatus: string = created.status
    if (initialStatus === 'PENDING_START') {
      const r = await tryAutoApproveHandover({ incomingSessionId: created.id })
      autoApproved = r.approved
      autoReason = r.reason
      if (r.approved) finalStatus = 'ACTIVE'
    }

    return NextResponse.json({
      success: true,
      data: { id: created.id, status: finalStatus, autoApproved, autoApprovalReason: autoReason },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

const patchSchema = z.object({
  action: z.enum(['requestEnd', 'approveHandover', 'cancel', 'edit']),
  sessionId: z.string(),
  // Fields below are only read by the 'edit' action.
  shiftNumber: z.enum(['ONE', 'TWO', 'THREE']).nullable().optional(),
  walletIds: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().nullable().optional(),
})

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const body = await req.json()
    const parsed = patchSchema.parse(body)
    const { action, sessionId } = parsed

    const target = await db.shiftSession.findUnique({ where: { id: sessionId } })
    if (!target) return NextResponse.json({ error: 'الجلسة غير موجودة' }, { status: 404 })

    if (action === 'requestEnd') {
      // Only the session's owner (or admin) can request end
      if (target.userId !== session.userId && session.role !== UserRole.ADMIN && session.role !== UserRole.MANAGER) {
        return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
      }
      if (target.status !== 'ACTIVE') {
        return NextResponse.json({ error: 'الجلسة ليست نشطة' }, { status: 400 })
      }
      await db.shiftSession.update({
        where: { id: sessionId },
        data: { status: 'PENDING_END' },
      })
      await audit(session.userId, 'REQUEST_END_SHIFT', 'ShiftSession', sessionId, {})

      // Mutual-handover trigger: if an incoming employee has already checked in
      // and is parked in PENDING_START waiting for *this* user, the auto-approval
      // can now fire from the outgoing side and complete both sessions.
      const r = await tryAutoApproveHandover({ outgoingSessionId: sessionId })
      return NextResponse.json({
        success: true,
        autoApproved: r.approved,
        autoApprovalReason: r.reason,
      })
    }

    if (action === 'approveHandover') {
      requireRole(session, [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPERVISOR])
      // target is the INCOMING session (PENDING_START)
      if (target.status !== 'PENDING_START') {
        return NextResponse.json({ error: 'الجلسة ليست بانتظار الموافقة' }, { status: 400 })
      }
      const outgoingUserId = target.handoverFromUserId
      const now = new Date()
      // Atomic transaction: only one approver can flip the statuses.
      // We use updateMany() with a status guard so concurrent calls collide
      // on row state (the second caller updates 0 rows).
      await db.$transaction(async (tx: typeof db) => {
        const flipIncoming = await tx.shiftSession.updateMany({
          where: { id: sessionId, status: 'PENDING_START' },
          data: {
            status: 'ACTIVE',
            startAt: now,
            approvedById: session.userId,
            approvedAt: now,
          },
        })
        if (flipIncoming.count === 0) {
          throw new Error('الجلسة لم تعد بانتظار الموافقة')
        }
        if (outgoingUserId) {
          const outgoing = await tx.shiftSession.findFirst({
            where: { userId: outgoingUserId, status: 'PENDING_END' },
            orderBy: { startAt: 'desc' },
          })
          if (outgoing) {
            const duration = Math.round((now.getTime() - outgoing.startAt.getTime()) / 60000)
            await tx.shiftSession.updateMany({
              where: { id: outgoing.id, status: 'PENDING_END' },
              data: {
                status: 'COMPLETED',
                endAt: now,
                durationMinutes: duration,
                approvedById: session.userId,
                approvedAt: now,
              },
            })
          }
        }
      })
      await audit(session.userId, 'APPROVE_HANDOVER', 'ShiftSession', sessionId, {})
      return NextResponse.json({ success: true })
    }

    if (action === 'cancel') {
      if (target.userId !== session.userId && session.role !== UserRole.ADMIN && session.role !== UserRole.MANAGER) {
        return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
      }
      await db.shiftSession.update({
        where: { id: sessionId },
        data: { status: 'CANCELLED', endAt: new Date() },
      })
      await audit(session.userId, 'CANCEL_SHIFT', 'ShiftSession', sessionId, {})
      return NextResponse.json({ success: true })
    }

    if (action === 'edit') {
      // Permission model:
      //   - Self: can edit notes + walletIds on their OWN open session
      //     (status in ACTIVE | PENDING_END | PENDING_START)
      //   - ADMIN | MANAGER | SUPERVISOR: can edit any session, including
      //     shiftNumber + time corrections (startAt / endAt) on COMPLETED
      //     sessions — for accounting fixes.
      const isAdminTier = session.role === UserRole.ADMIN
        || session.role === UserRole.MANAGER
        || session.role === UserRole.SUPERVISOR
      const isSelf = target.userId === session.userId
      if (!isAdminTier && !isSelf) {
        return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
      }
      const isOpen = target.status === 'ACTIVE' || target.status === 'PENDING_END' || target.status === 'PENDING_START'
      if (!isAdminTier && !isOpen) {
        return NextResponse.json({
          error: 'يمكن للموظف تعديل جلسته أثناء كونها نشطة فقط. تواصل مع المشرف للتعديلات على الجلسات المغلقة.',
        }, { status: 403 })
      }

      // Field-level gating: self-edit can only touch notes + walletIds.
      const dataUpdates: Record<string, unknown> = {}
      if (parsed.notes !== undefined) dataUpdates.notes = parsed.notes
      if (isAdminTier) {
        if (parsed.shiftNumber !== undefined) dataUpdates.shiftNumber = parsed.shiftNumber
        if (parsed.startAt !== undefined) dataUpdates.startAt = new Date(parsed.startAt)
        if (parsed.endAt !== undefined) {
          dataUpdates.endAt = parsed.endAt ? new Date(parsed.endAt) : null
          // If both timestamps are now set, recompute duration so reports stay
          // consistent with the new window.
          const start = (dataUpdates.startAt as Date | undefined) ?? target.startAt
          const end = dataUpdates.endAt as Date | null
          if (end && start) {
            dataUpdates.durationMinutes = Math.round((end.getTime() - new Date(start).getTime()) / 60000)
          }
        }
      } else if (parsed.shiftNumber !== undefined || parsed.startAt !== undefined || parsed.endAt !== undefined) {
        return NextResponse.json({
          error: 'لا تملك صلاحية تعديل توقيت/رقم المناوبة. هذا للمشرف.',
        }, { status: 403 })
      }

      // Wallet edits replace the full set; validate against the user's allowed
      // assignments (the same check the check-in flow runs).
      let walletDelta = false
      if (parsed.walletIds) {
        const allowed = await db.employeeWalletAssignment.findMany({
          where: { userId: target.userId, accountId: { in: parsed.walletIds } },
          select: { accountId: true },
        })
        const allowedIds = new Set(allowed.map((a: { accountId: string }) => a.accountId))
        const invalid = parsed.walletIds.filter((id: string) => !allowedIds.has(id))
        if (invalid.length > 0) {
          return NextResponse.json({
            error: `غير مسموح بـ ${invalid.length} محفظة من المختارة لهذا الموظف.`,
          }, { status: 400 })
        }
        walletDelta = true
      }

      // Apply scalar updates + wallet rewrite atomically.
      await db.$transaction(async (tx: typeof db) => {
        if (Object.keys(dataUpdates).length > 0) {
          await tx.shiftSession.update({
            where: { id: sessionId },
            data: dataUpdates,
            select: { id: true },
          })
        }
        if (walletDelta) {
          await tx.shiftSessionWallet.deleteMany({ where: { sessionId } })
          if (parsed.walletIds!.length > 0) {
            await tx.shiftSessionWallet.createMany({
              data: parsed.walletIds!.map((accountId: string) => ({ sessionId, accountId })),
            })
          }
        }
      })

      await audit(session.userId, 'EDIT_SHIFT_SESSION', 'ShiftSession', sessionId, {
        fieldsChanged: Object.keys(dataUpdates),
        walletsChanged: walletDelta,
        bySelf: isSelf && !isAdminTier,
      })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'إجراء غير صالح' }, { status: 400 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
