import { describe, it, expect } from 'vitest'

// Pure logic mirror of the auto-approval HARD gates. The only hard blocks
// are: a handover source still ACTIVE on shift, and the incoming employee not
// being scheduled. Wallet coverage and a no-show (absent) source are NOT
// gates — they are soft checks that only stamp a warning note — so they are
// intentionally absent here. The actual implementation lives in
// src/lib/shifts/autoApprove.ts and is exercised end-to-end with a mocked DB
// in tests/shifts.autoApprove.integration.test.ts.

interface SessionLite {
  id: string
  status: string
  handoverFromUserId: string | null
  shiftNumber: 'ONE' | 'TWO' | 'THREE' | null
  wallets: Array<{ accountId: string }>
  userId: string
}
interface ShiftLite { userId: string; shiftNumber: string; isDayOff: boolean }

function gate(opts: {
  incoming: SessionLite
  outgoing: SessionLite | null
  scheduledToday: ShiftLite | null
}): { approved: boolean; reason?: string } {
  const { incoming, outgoing, scheduledToday } = opts
  if (incoming.status !== 'PENDING_START') return { approved: false, reason: 'الجلسة ليست بانتظار الموافقة' }
  if (!incoming.handoverFromUserId)        return { approved: false, reason: 'لا يوجد تسليم لمطابقته' }
  if (!incoming.shiftNumber)               return { approved: false, reason: 'رقم المناوبة غير محدد — يلزم موافقة يدوية' }
  // A source still ACTIVE on shift hard-blocks; a missing/no-show source does not.
  if (outgoing && outgoing.status === 'ACTIVE') return { approved: false, reason: 'في انتظار تسجيل خروج جميع موظفي الشيفت السابق' }

  if (!scheduledToday)                     return { approved: false, reason: 'الموظف غير مجدول لهذه المناوبة اليوم' }
  if (scheduledToday.isDayOff)             return { approved: false, reason: 'الموظف غير مجدول لهذه المناوبة اليوم' }
  if (scheduledToday.userId !== incoming.userId) return { approved: false, reason: 'الموظف غير مجدول لهذه المناوبة اليوم' }
  if (scheduledToday.shiftNumber !== incoming.shiftNumber) return { approved: false, reason: 'الموظف غير مجدول لهذه المناوبة اليوم' }

  return { approved: true }
}

const baseIn: SessionLite = {
  id: 'in', status: 'PENDING_START', handoverFromUserId: 'u-out',
  shiftNumber: 'TWO', wallets: [{ accountId: 'w1' }, { accountId: 'w2' }], userId: 'u-in',
}
const baseOut: SessionLite = {
  id: 'out', status: 'PENDING_END', handoverFromUserId: null,
  shiftNumber: 'ONE', wallets: [{ accountId: 'w1' }, { accountId: 'w2' }], userId: 'u-out',
}
const baseSched: ShiftLite = { userId: 'u-in', shiftNumber: 'TWO', isDayOff: false }

describe('handover auto-approval gate', () => {
  it('approves when wallets + schedule match', () => {
    expect(gate({ incoming: baseIn, outgoing: baseOut, scheduledToday: baseSched }))
      .toEqual({ approved: true })
  })

  it('rejects when shiftNumber missing', () => {
    const r = gate({ incoming: { ...baseIn, shiftNumber: null }, outgoing: baseOut, scheduledToday: baseSched })
    expect(r.approved).toBe(false)
    expect(r.reason).toContain('رقم المناوبة')
  })

  it('approves when the handover source is absent / a no-show', () => {
    const r = gate({ incoming: baseIn, outgoing: null, scheduledToday: baseSched })
    expect(r).toEqual({ approved: true })
  })

  it('rejects when a handover source is still ACTIVE on shift', () => {
    const r = gate({
      incoming: baseIn,
      outgoing: { ...baseOut, status: 'ACTIVE' },
      scheduledToday: baseSched,
    })
    expect(r.approved).toBe(false)
    expect(r.reason).toContain('في انتظار تسجيل خروج')
  })

  it('approves even when wallet sets differ (wallet coverage is not a gate)', () => {
    const r = gate({
      incoming: { ...baseIn, wallets: [{ accountId: 'wX' }, { accountId: 'w2' }] },
      outgoing: baseOut, scheduledToday: baseSched,
    })
    expect(r).toEqual({ approved: true })
  })

  it('rejects when not scheduled', () => {
    const r = gate({ incoming: baseIn, outgoing: baseOut, scheduledToday: null })
    expect(r.approved).toBe(false)
    expect(r.reason).toContain('غير مجدول')
  })

  it('rejects when scheduled day is OFF', () => {
    const r = gate({ incoming: baseIn, outgoing: baseOut, scheduledToday: { ...baseSched, isDayOff: true } })
    expect(r.approved).toBe(false)
  })

  it('rejects when scheduled shift number differs', () => {
    const r = gate({ incoming: baseIn, outgoing: baseOut, scheduledToday: { ...baseSched, shiftNumber: 'THREE' } })
    expect(r.approved).toBe(false)
  })

  it('rejects when scheduled user id differs (other employee)', () => {
    const r = gate({ incoming: baseIn, outgoing: baseOut, scheduledToday: { ...baseSched, userId: 'u-other' } })
    expect(r.approved).toBe(false)
  })

  it('approves with empty wallet sets on both sides', () => {
    const r = gate({
      incoming: { ...baseIn, wallets: [] },
      outgoing: { ...baseOut, wallets: [] },
      scheduledToday: baseSched,
    })
    expect(r).toEqual({ approved: true })
  })
})
