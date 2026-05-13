import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'

// GET /api/shifts/sessions/counterpart?walletIds=acc1,acc2
//
// Given the set of wallets the incoming employee is about to take, find the
// single user who currently holds *exactly* those wallets in an open session
// (ACTIVE or PENDING_END). That user is the handover counterpart — the
// check-in form pre-fills handoverFromUserId so the incoming employee doesn't
// have to know who they're taking over from.
//
// Response shapes:
//   - One match     → { counterpart: { id, name }, sessionId, sessionStatus }
//   - Zero matches  → { counterpart: null }   (independent check-in)
//   - Multiple      → { counterpart: null, ambiguous: true, candidates: [...] }

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const url = new URL(req.url)
  const raw = url.searchParams.get('walletIds') || ''
  const walletIds = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  if (walletIds.length === 0) {
    return NextResponse.json(
      { error: 'walletIds مطلوب' },
      { status: 400 },
    )
  }

  // Pull all open sessions that contain AT LEAST one of the requested wallets.
  // We then filter in-memory for the exact-set match (DB-side multi-row joins
  // would be more complex than the volume justifies — open sessions are few).
  const candidates = await db.shiftSession.findMany({
    where: {
      status: { in: ['ACTIVE', 'PENDING_END'] },
      wallets: { some: { accountId: { in: walletIds } } },
    },
    include: {
      user: { select: { id: true, name: true } },
      wallets: { select: { accountId: true } },
    },
  })

  // Exact-set match: session's wallet set ⊇ requested set. (We don't require
  // equality in the other direction — the incoming employee might be taking
  // a subset of the outgoing employee's wallets.)
  const requested = new Set(walletIds)
  const matches = candidates.filter((s: typeof candidates[0]) => {
    const held = new Set(s.wallets.map((w: { accountId: string }) => w.accountId))
    for (const id of requested) {
      if (!held.has(id)) return false
    }
    return true
  })

  if (matches.length === 0) {
    return NextResponse.json({ success: true, counterpart: null })
  }

  if (matches.length === 1) {
    const m = matches[0]
    return NextResponse.json({
      success: true,
      counterpart: { id: m.user.id, name: m.user.name },
      sessionId: m.id,
      sessionStatus: m.status,
    })
  }

  return NextResponse.json({
    success: true,
    counterpart: null,
    ambiguous: true,
    candidates: matches.map((m: typeof matches[0]) => ({
      id: m.user.id,
      name: m.user.name,
      sessionId: m.id,
      sessionStatus: m.status,
    })),
  })
}
