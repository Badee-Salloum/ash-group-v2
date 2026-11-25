import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { tryAutoApproveHandover } from '@/lib/shifts/autoApprove'
import { damascusDateStr, dateColumnUtc, addDays, fmtSyria } from '@/lib/datetime'
import { checkinWindowUtc, type ShiftNumber } from '@/lib/shifts/shiftWindow'
import { z } from 'zod'

// Validate that the requested wallet IDs are allowed for this user at this
// shift slot. Resolution order:
//   1. If the user has a scheduled Shift for today (or `forDate`) at this
//      `shiftNumber` with isDayOff=false, walletIds must be a SUBSET of that
//      shift's planned wallets (ShiftWallet rows).
//   2. Otherwise (ad-hoc check-in or no schedule), walletIds must reference
//      active Account rows — any active wallet is acceptable.
// Returns null on success, or { error, status } on failure.
async function validateWalletsForShift(args: {
  userId: string
  shiftNumber: 'ONE' | 'TWO' | 'THREE' | null | undefined
  walletIds: string[]
  forDate?: Date
}): Promise<{ error: string; status: number } | null> {
  const { userId, shiftNumber, walletIds, forDate } = args
  if (walletIds.length === 0) return null

  if (shiftNumber) {
    const dayKey = damascusDateStr(forDate ?? new Date())
    const dayStart = dateColumnUtc(dayKey)
    const dayEnd = dateColumnUtc(addDays(dayKey, 1))
    const scheduled = await db.shift.findFirst({
      where: {
        userId,
        shiftNumber,
        date: { gte: dayStart, lt: dayEnd },
        isDayOff: false,
      },
      include: { wallets: { select: { accountId: true } } },
    })
    if (scheduled) {
      const allowed = new Set(
        scheduled.wallets.map((w: { accountId: string }) => w.accountId),
      )
      // Phase F — coverage half-shifts let the covering user temporarily use
      // the on-leave employee's wallets. Merge those wallet ids into the
      // allowed set for this user on this day.
      const coverageRows = await db.coverageAssignment.findMany({
        where: {
          userId,
          date: { gte: dayStart, lt: dayEnd },
        },
        include: {
          originalShift: { include: { wallets: { select: { accountId: true } } } },
        },
      })
      type CovRow = { originalShift: { wallets: Array<{ accountId: string }> } | null }
      for (const c of coverageRows as CovRow[]) {
        for (const w of c.originalShift?.wallets ?? []) allowed.add(w.accountId)
      }
      const invalid = walletIds.filter(id => !allowed.has(id))
      if (invalid.length > 0) {
        return {
          error: `${invalid.length} محفظة غير مُخطَّطة لهذه المناوبة. راجع جدول المناوبات.`,
          status: 400,
        }
      }
      return null
    }
  }

  // Fallback: validate against active accounts only (no schedule constraint).
  const active = await db.account.findMany({
    where: { id: { in: walletIds }, isActive: true },
    select: { id: true },
  })
  const activeSet = new Set(active.map((a: { id: string }) => a.id))
  const invalid = walletIds.filter(id => !activeSet.has(id))
  if (invalid.length > 0) {
    return {
      error: `${invalid.length} محفظة غير صالحة أو غير مُفعَّلة.`,
      status: 400,
    }
  }
  return null
}

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
  // EMPLOYEE-role callers may only ever see their OWN sessions — ignore any
  // userId param they pass. Higher roles may query any/all.
  if (session.role === UserRole.EMPLOYEE) {
    where.userId = session.userId
  } else if (userId) {
    where.userId = userId
  }
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

// Check-in is fully schedule-driven — the client sends no parameters. The
// server resolves the caller's scheduled Shift (must be inside its check-in
// window), copies its shiftNumber + planned wallets + handover sources, and
// enforces that every handover source has already requested check-out.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    // 1 — Already has an open session?
    const existing = await db.shiftSession.findFirst({
      where: {
        userId: session.userId,
        status: { in: ['ACTIVE', 'PENDING_END', 'PENDING_START'] },
      },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'لديك جلسة مفتوحة بالفعل. سجّل خروج منها أولاً.' },
        { status: 409 },
      )
    }

    // 2 — Resolve the applicable scheduled Shift. Look at yesterday + today
    // (a THREE shift dated yesterday is still checkin-able after midnight) and
    // pick the one whose absolute check-in window currently contains `now`.
    const nowMs = Date.now()
    const today = damascusDateStr(new Date())
    const yesterday = addDays(today, -1)
    const candidates = await db.shift.findMany({
      where: {
        userId: session.userId,
        isDayOff: false,
        date: {
          gte: dateColumnUtc(yesterday),
          lt: dateColumnUtc(addDays(today, 1)),
        },
      },
      include: { wallets: { select: { accountId: true } } },
    })
    let scheduled: (typeof candidates)[number] | null = null
    let nextOpenMs: number | null = null
    for (const c of candidates) {
      const dayKey = damascusDateStr(c.date)
      const w = checkinWindowUtc(dayKey, c.shiftNumber as ShiftNumber)
      const openFromMs = w.openFrom.getTime()
      if (nowMs >= openFromMs && nowMs <= w.end.getTime()) {
        scheduled = c
        break
      }
      if (openFromMs > nowMs && (nextOpenMs === null || openFromMs < nextOpenMs)) {
        nextOpenMs = openFromMs
      }
    }
    if (!scheduled) {
      // Distinguish "no shift at all" from "scheduled, but the check-in window
      // isn't open yet" — the latter must not read as "not scheduled".
      if (nextOpenMs !== null) {
        return NextResponse.json(
          { error: `تسجيل الدخول لمناوبتك يفتح الساعة ${fmtSyria(new Date(nextOpenMs), false).slice(11)}.` },
          { status: 403 },
        )
      }
      if (candidates.length > 0) {
        return NextResponse.json(
          { error: 'انتهت نافذة تسجيل الدخول لمناوبتك. تواصل مع المشرف.' },
          { status: 403 },
        )
      }
      return NextResponse.json(
        { error: 'لست مجدولاً لمناوبة في هذا الوقت. تواصل مع المشرف.' },
        { status: 403 },
      )
    }

    // 3 — Multi-source handover gate. Every source must have at least
    // requested check-out; if any is still plain ACTIVE → hard block.
    const sources: string[] = scheduled.handoverFromUserIds || []
    let initialStatus: 'ACTIVE' | 'PENDING_START' = 'ACTIVE'
    if (sources.length > 0) {
      const blocking: string[] = []
      let anyPendingEnd = false
      for (const srcId of sources) {
        const sess = await db.shiftSession.findFirst({
          where: { userId: srcId },
          orderBy: { startAt: 'desc' },
          select: { status: true },
        })
        if (sess?.status === 'ACTIVE') blocking.push(srcId)
        else if (sess?.status === 'PENDING_END') anyPendingEnd = true
      }
      if (blocking.length > 0) {
        const names = await db.user.findMany({
          where: { id: { in: blocking } },
          select: { name: true },
        })
        return NextResponse.json(
          {
            error: `في انتظار تسجيل خروج: ${names.map((n: { name: string }) => n.name).join('، ')}`,
          },
          { status: 409 },
        )
      }
      // Sources are all PENDING_END/COMPLETED/absent. Only park as
      // PENDING_START when there is a real PENDING_END to hand over from.
      initialStatus = anyPendingEnd ? 'PENDING_START' : 'ACTIVE'
    }

    // 4 — Create the session. shiftNumber + wallets come from the schedule.
    const walletIds = scheduled.wallets.map((w: { accountId: string }) => w.accountId)
    const created = await db.shiftSession.create({
      data: {
        userId: session.userId,
        shiftNumber: scheduled.shiftNumber,
        status: initialStatus,
        handoverFromUserId: sources[0] ?? null,
        handoverFromUserIds: sources,
        wallets: { create: walletIds.map((accountId: string) => ({ accountId })) },
      },
    })

    await audit(session.userId, 'CHECK_IN', 'ShiftSession', created.id, {
      shiftNumber: scheduled.shiftNumber,
      walletCount: walletIds.length,
      handoverSources: sources.length,
    })

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
  action: z.enum(['requestEnd', 'approveHandover', 'cancel', 'forceComplete', 'edit']),
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

      // Is anyone scheduled to take over from this employee? Look for a
      // non-day-off Shift in the next-shift window that lists them as a
      // handover source. (Shift.date is a @db.Date column → dateColumnUtc.)
      const today = damascusDateStr(new Date())
      const successor = await db.shift.findFirst({
        where: {
          handoverFromUserIds: { has: target.userId },
          isDayOff: false,
          date: { gte: dateColumnUtc(today), lt: dateColumnUtc(addDays(today, 2)) },
        },
        select: { id: true },
      })

      // No successor scheduled → nothing to hand over → close the shift now
      // instead of stranding it in PENDING_END «بانتظار وصول الموظف التالي».
      if (!successor) {
        const now = new Date()
        const duration = Math.round((now.getTime() - target.startAt.getTime()) / 60000)
        await db.shiftSession.update({
          where: { id: sessionId },
          data: {
            status: 'COMPLETED',
            endAt: now,
            durationMinutes: duration,
            notes: target.notes
              ? `${target.notes} · إغلاق تلقائي — لا يوجد تسليم تالٍ`
              : 'إغلاق تلقائي — لا يوجد تسليم تالٍ مجدول',
          },
        })
        await audit(session.userId, 'REQUEST_END_SHIFT', 'ShiftSession', sessionId, { autoCompleted: true })
        return NextResponse.json({ success: true, autoApproved: false, completed: true })
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
      // All handover sources (multi-value field, legacy single as fallback).
      const outgoingUserIds = target.handoverFromUserIds?.length
        ? target.handoverFromUserIds
        : (target.handoverFromUserId ? [target.handoverFromUserId] : [])
      const now = new Date()
      // Atomic transaction: only one approver can flip the statuses.
      // updateMany() with a status guard makes concurrent calls collide
      // (the second caller updates 0 rows).
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
        // Complete every source's PENDING_END session.
        for (const outgoingUserId of outgoingUserIds) {
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

    if (action === 'forceComplete') {
      // Admin / Manager override: close an ACTIVE or PENDING_END session as
      // COMPLETED without requiring a handover counterpart. Use case: the next
      // employee never showed up, or the outgoing employee left without
      // formally requesting end. Bypasses the normal handover validation.
      requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])
      if (target.status !== 'ACTIVE' && target.status !== 'PENDING_END') {
        return NextResponse.json({
          error: 'الإنهاء اليدوي متاح فقط للجلسات النشطة أو بانتظار الإغلاق',
        }, { status: 400 })
      }
      const now = new Date()
      const duration = Math.round((now.getTime() - target.startAt.getTime()) / 60000)
      await db.shiftSession.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          endAt: now,
          durationMinutes: duration,
          approvedById: session.userId,
          approvedAt: now,
          notes: target.notes
            ? `${target.notes} · إنهاء يدوي`
            : 'إنهاء يدوي من المشرف',
        },
      })
      await audit(session.userId, 'FORCE_COMPLETE_SHIFT', 'ShiftSession', sessionId, {
        previousStatus: target.status,
        durationMinutes: duration,
      })
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

      // Wallet edits replace the full set. Validate against the target
      // session's own scheduled shift (date + shiftNumber + user) rather than
      // a per-user allowlist; admins can still edit any wallet on an open or
      // recently-closed session via the fallback (no schedule = any active
      // account is allowed).
      let walletDelta = false
      if (parsed.walletIds) {
        const sessionShiftNumber = (parsed.shiftNumber ?? target.shiftNumber) as
          'ONE' | 'TWO' | 'THREE' | null
        const walletError = await validateWalletsForShift({
          userId: target.userId,
          shiftNumber: sessionShiftNumber,
          walletIds: parsed.walletIds,
          forDate: target.startAt,
        })
        if (walletError) {
          return NextResponse.json({ error: walletError.error }, { status: walletError.status })
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
