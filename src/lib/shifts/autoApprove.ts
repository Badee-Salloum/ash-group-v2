// Auto-approval for shift handovers.
//
// A handover involves two sessions:
//   - INCOMING: a new ShiftSession in PENDING_START (handoverFromUserId set)
//   - OUTGOING: the prior ShiftSession in PENDING_END (the user requested end)
//
// When BOTH sides have done their part, this function flips both atomically:
//   incoming PENDING_START → ACTIVE
//   outgoing PENDING_END   → COMPLETED
//
// Either side can be the *trigger*:
//   - check-in fires it with { incomingSessionId } after creating the incoming
//   - request-end fires it with { outgoingSessionId } after flipping outgoing
// Whichever request happens last completes the handover. If only one side has
// done their part, this function returns { approved: false, reason } so the
// UI can render meaningful "waiting for X" feedback.
//
// Guards:
//   - Wallet sets must match (exact equality, both directions)
//   - Incoming employee must be scheduled for this shift+date+isDayOff:false
//   - Atomic via updateMany() with status guards — concurrent triggers cannot
//     both succeed (the second sees count:0 from the status guard)

import { db } from '@/lib/db/client'
import { audit } from '@/lib/auth'

export type AutoApproveTrigger =
  | { incomingSessionId: string }
  | { outgoingSessionId: string }

export interface AutoApproveResult {
  approved: boolean
  reason?: string
}

interface SessionWithWallets {
  id: string
  userId: string
  status: string
  shiftNumber: string | null
  handoverFromUserId: string | null
  notes: string | null
  startAt: Date
  wallets: { accountId: string }[]
}

function isIncomingTrigger(t: AutoApproveTrigger): t is { incomingSessionId: string } {
  return 'incomingSessionId' in t
}

async function loadIncomingByOutgoing(outgoingUserId: string): Promise<SessionWithWallets | null> {
  // Most-recent PENDING_START whose handoverFromUserId == outgoing's user.
  return db.shiftSession.findFirst({
    where: { status: 'PENDING_START', handoverFromUserId: outgoingUserId },
    include: { wallets: true },
    orderBy: { startAt: 'desc' },
  })
}

async function loadOutgoingByIncoming(incomingFromUserId: string): Promise<SessionWithWallets | null> {
  return db.shiftSession.findFirst({
    where: { status: 'PENDING_END', userId: incomingFromUserId },
    include: { wallets: true },
    orderBy: { startAt: 'desc' },
  })
}

export async function tryAutoApproveHandover(
  trigger: AutoApproveTrigger,
): Promise<AutoApproveResult> {
  // ── Resolve both sides regardless of which one triggered. ──
  let incoming: SessionWithWallets | null
  let outgoing: SessionWithWallets | null

  if (isIncomingTrigger(trigger)) {
    incoming = await db.shiftSession.findUnique({
      where: { id: trigger.incomingSessionId },
      include: { wallets: true },
    })
    if (!incoming || incoming.status !== 'PENDING_START') {
      return { approved: false, reason: 'الجلسة ليست بانتظار الموافقة' }
    }
    if (!incoming.handoverFromUserId) {
      return { approved: false, reason: 'لا يوجد تسليم لمطابقته' }
    }
    outgoing = await loadOutgoingByIncoming(incoming.handoverFromUserId)
    if (!outgoing) {
      return { approved: false, reason: 'في انتظار تسجيل خروج الموظف السابق' }
    }
  } else {
    outgoing = await db.shiftSession.findUnique({
      where: { id: trigger.outgoingSessionId },
      include: { wallets: true },
    })
    if (!outgoing || outgoing.status !== 'PENDING_END') {
      return { approved: false, reason: 'الجلسة ليست بانتظار الإغلاق' }
    }
    incoming = await loadIncomingByOutgoing(outgoing.userId)
    if (!incoming) {
      return { approved: false, reason: 'في انتظار تسجيل دخول الموظف التالي' }
    }
  }

  if (!incoming.shiftNumber) {
    return { approved: false, reason: 'رقم المناوبة غير محدد — يلزم موافقة يدوية' }
  }

  // ── Wallet-set equality (both directions, exact). ──
  const inSet = new Set(incoming.wallets.map(w => w.accountId))
  const outSet = new Set(outgoing.wallets.map(w => w.accountId))
  if (inSet.size !== outSet.size) {
    return { approved: false, reason: 'عدد المحافظ المسلَّمة لا يطابق المستلَمة' }
  }
  for (const id of inSet) {
    if (!outSet.has(id)) {
      return { approved: false, reason: 'المحافظ المختارة لا تطابق المحافظ المسلَّمة' }
    }
  }

  // ── Schedule check: incoming must be on the roster today, not isDayOff. ──
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart)
  todayEnd.setDate(todayStart.getDate() + 1)
  const scheduled = await db.shift.findFirst({
    where: {
      userId: incoming.userId,
      shiftNumber: incoming.shiftNumber as 'ONE' | 'TWO' | 'THREE',
      date: { gte: todayStart, lt: todayEnd },
      isDayOff: false,
    },
  })
  if (!scheduled) {
    return { approved: false, reason: 'الموظف غير مجدول لهذه المناوبة اليوم' }
  }

  // ── Atomic flip. updateMany() with a status guard means concurrent triggers
  //    cannot both succeed (the second sees count:0 because status moved). ──
  const now = new Date()
  try {
    await db.$transaction(async (tx: typeof db) => {
      const flipIncoming = await tx.shiftSession.updateMany({
        where: { id: incoming!.id, status: 'PENDING_START' },
        data: {
          status: 'ACTIVE',
          startAt: now,
          approvedById: null,
          approvedAt: now,
          notes: incoming!.notes
            ? `${incoming!.notes} · موافقة تلقائية`
            : 'موافقة تلقائية (مطابقة محافظ + جدول)',
        },
      })
      if (flipIncoming.count === 0) {
        throw new Error('race')
      }
      const duration = Math.round((now.getTime() - outgoing!.startAt.getTime()) / 60000)
      await tx.shiftSession.updateMany({
        where: { id: outgoing!.id, status: 'PENDING_END' },
        data: {
          status: 'COMPLETED',
          endAt: now,
          durationMinutes: duration,
          approvedById: null,
          approvedAt: now,
        },
      })
    })
  } catch {
    return { approved: false, reason: 'لم يتم التحديث (تعارض متزامن)' }
  }

  await audit(incoming.userId, 'AUTO_APPROVE_HANDOVER', 'ShiftSession', incoming.id, {
    outgoingSessionId: outgoing.id,
    walletCount: inSet.size,
    triggeredBy: isIncomingTrigger(trigger) ? 'incoming' : 'outgoing',
  })
  return { approved: true }
}
