// Auto-approval for shift handovers.
//
// A handover involves:
//   - INCOMING: a new ShiftSession in PENDING_START. It carries
//     `handoverFromUserIds` — the set of previous-shift employees it takes
//     over from (copied from the scheduled Shift at check-in).
//   - OUTGOING(s): one ShiftSession per source user in PENDING_END (each
//     requested check-out).
//
// When the incoming employee has checked in AND every source has requested
// check-out, this flips them all atomically:
//   incoming PENDING_START → ACTIVE
//   each outgoing PENDING_END → COMPLETED
//
// Either side can trigger it:
//   - check-in fires { incomingSessionId } after creating the incoming
//   - request-end fires { outgoingSessionId } after a source flips to PENDING_END
// Whichever request is last completes the handover. If a side is still
// missing, returns { approved: false, reason } for "waiting for X" feedback.
//
// Guards:
//   - Incoming wallets ⊆ union of all sources' wallets
//   - Incoming employee must be scheduled today (not isDayOff)
//   - Atomic via updateMany() status guards — concurrent triggers can't both win

import { db } from '@/lib/db/client'
import { audit } from '@/lib/auth'
import { damascusDateStr, dateColumnUtc, addDays } from '@/lib/datetime'

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
  handoverFromUserIds: string[]
  notes: string | null
  startAt: Date
  wallets: { accountId: string }[]
}

function isIncomingTrigger(t: AutoApproveTrigger): t is { incomingSessionId: string } {
  return 'incomingSessionId' in t
}

async function loadIncoming(id: string): Promise<SessionWithWallets | null> {
  return db.shiftSession.findUnique({ where: { id }, include: { wallets: true } })
}

// Most-recent PENDING_START whose handover source set includes `outgoingUserId`.
async function loadIncomingByOutgoingUser(outgoingUserId: string): Promise<SessionWithWallets | null> {
  return db.shiftSession.findFirst({
    where: { status: 'PENDING_START', handoverFromUserIds: { has: outgoingUserId } },
    include: { wallets: true },
    orderBy: { startAt: 'desc' },
  })
}

async function loadPendingEndFor(userId: string): Promise<SessionWithWallets | null> {
  return db.shiftSession.findFirst({
    where: { status: 'PENDING_END', userId },
    include: { wallets: true },
    orderBy: { startAt: 'desc' },
  })
}

export async function tryAutoApproveHandover(
  trigger: AutoApproveTrigger,
): Promise<AutoApproveResult> {
  // ── Resolve the incoming session. ──
  let incoming: SessionWithWallets | null
  if (isIncomingTrigger(trigger)) {
    incoming = await loadIncoming(trigger.incomingSessionId)
    if (!incoming || incoming.status !== 'PENDING_START') {
      return { approved: false, reason: 'الجلسة ليست بانتظار الموافقة' }
    }
  } else {
    const outg = await db.shiftSession.findUnique({
      where: { id: trigger.outgoingSessionId },
      select: { status: true, userId: true },
    })
    if (!outg || outg.status !== 'PENDING_END') {
      return { approved: false, reason: 'الجلسة ليست بانتظار الإغلاق' }
    }
    incoming = await loadIncomingByOutgoingUser(outg.userId)
    if (!incoming) {
      return { approved: false, reason: 'في انتظار تسجيل دخول الموظف التالي' }
    }
  }

  // Source set — prefer the multi-value field, fall back to the legacy single.
  const sources = incoming.handoverFromUserIds?.length
    ? incoming.handoverFromUserIds
    : (incoming.handoverFromUserId ? [incoming.handoverFromUserId] : [])
  if (sources.length === 0) {
    return { approved: false, reason: 'لا يوجد تسليم لمطابقته' }
  }
  if (!incoming.shiftNumber) {
    return { approved: false, reason: 'رقم المناوبة غير محدد — يلزم موافقة يدوية' }
  }

  // ── Every source must have a PENDING_END session waiting. ──
  const outgoings: SessionWithWallets[] = []
  for (const srcId of sources) {
    const o = await loadPendingEndFor(srcId)
    if (!o) {
      return { approved: false, reason: 'في انتظار تسجيل خروج جميع موظفي الشيفت السابق' }
    }
    outgoings.push(o)
  }

  // ── Wallet coverage: incoming wallets ⊆ union of all sources' wallets. ──
  const union = new Set<string>()
  for (const o of outgoings) {
    for (const w of o.wallets) union.add(w.accountId)
  }
  for (const w of incoming.wallets) {
    if (!union.has(w.accountId)) {
      return { approved: false, reason: 'المحافظ المستلَمة لا تغطّيها المحافظ المسلَّمة' }
    }
  }

  // ── Schedule check: incoming employee must be rostered today (Damascus). ──
  const todayKey = damascusDateStr(new Date())
  const scheduled = await db.shift.findFirst({
    where: {
      userId: incoming.userId,
      shiftNumber: incoming.shiftNumber as 'ONE' | 'TWO' | 'THREE',
      date: {
        gte: dateColumnUtc(todayKey),
        lt: dateColumnUtc(addDays(todayKey, 1)),
      },
      isDayOff: false,
    },
    select: { id: true },
  })
  if (!scheduled) {
    return { approved: false, reason: 'الموظف غير مجدول لهذه المناوبة اليوم' }
  }

  // ── Atomic flip: incoming → ACTIVE, every outgoing → COMPLETED. ──
  const now = new Date()
  try {
    await db.$transaction(async (tx: typeof db) => {
      const flipIn = await tx.shiftSession.updateMany({
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
      if (flipIn.count === 0) throw new Error('race')
      for (const o of outgoings) {
        const duration = Math.round((now.getTime() - o.startAt.getTime()) / 60000)
        await tx.shiftSession.updateMany({
          where: { id: o.id, status: 'PENDING_END' },
          data: {
            status: 'COMPLETED',
            endAt: now,
            durationMinutes: duration,
            approvedById: null,
            approvedAt: now,
          },
        })
      }
    })
  } catch {
    return { approved: false, reason: 'لم يتم التحديث (تعارض متزامن)' }
  }

  await audit(incoming.userId, 'AUTO_APPROVE_HANDOVER', 'ShiftSession', incoming.id, {
    outgoingSessionIds: outgoings.map(o => o.id),
    walletCount: incoming.wallets.length,
    triggeredBy: isIncomingTrigger(trigger) ? 'incoming' : 'outgoing',
  })
  return { approved: true }
}
