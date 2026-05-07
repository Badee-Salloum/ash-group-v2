import { db } from '@/lib/db/client'

// Module D — link transactions to the employee who handled them.
//
// For each transaction we look at:
//   1. The shift sessions (any status except CANCELLED) that cover its txDateTime
//   2. Whose wallet selection includes the transaction's accountId
// If exactly one matches → set handledByUserId and handledInSessionId.
// If multiple match (e.g. handover happened at this very second) → mark
// handlerAmbiguous = true and pick the earliest startAt.
// If none matches → leave NULL (transaction was outside any session).

export async function linkTransactionsToEmployees(opts: {
  accountId?: string
  batchId?: string
  fromDate?: Date
  onlyUnlinked?: boolean
} = {}): Promise<{ scanned: number; linked: number; ambiguous: number; unlinked: number }> {
  const where: Record<string, unknown> = {}
  if (opts.accountId) where.accountId = opts.accountId
  if (opts.batchId) where.batchId = opts.batchId
  if (opts.fromDate) where.txDateTime = { gte: opts.fromDate }
  if (opts.onlyUnlinked) where.handledByUserId = null

  const txs = await db.transaction.findMany({
    where,
    select: { id: true, accountId: true, txDateTime: true },
    take: 50000,
  })

  let linked = 0, ambiguous = 0, unlinked = 0

  // Pre-load active+completed sessions covering the relevant time range
  const minTime = txs.reduce((m: Date, t: typeof txs[0]) => t.txDateTime < m ? t.txDateTime : m, new Date())
  const maxTime = txs.reduce((m: Date, t: typeof txs[0]) => t.txDateTime > m ? t.txDateTime : m, new Date(0))
  const sessions = await db.shiftSession.findMany({
    where: {
      status: { not: 'CANCELLED' },
      OR: [
        { endAt: null, startAt: { lte: maxTime } },
        { endAt: { gte: minTime }, startAt: { lte: maxTime } },
      ],
    },
    include: { wallets: { select: { accountId: true } } },
  })

  // Build candidate map for quick lookup: walletId -> sessions[]
  const byWallet = new Map<string, typeof sessions>()
  for (const s of sessions) {
    for (const w of s.wallets) {
      if (!byWallet.has(w.accountId)) byWallet.set(w.accountId, [])
      byWallet.get(w.accountId)!.push(s)
    }
  }

  // Process in batches of 200 updates
  const updates: Array<Promise<unknown>> = []
  for (const t of txs) {
    const candidates = (byWallet.get(t.accountId) || []).filter((s: typeof sessions[0]) => {
      const startsBefore = s.startAt <= t.txDateTime
      const endsAfter = !s.endAt || s.endAt >= t.txDateTime
      return startsBefore && endsAfter
    })
    if (candidates.length === 0) {
      unlinked++
      continue
    }
    const isAmbiguous = candidates.length > 1
    candidates.sort((a: typeof sessions[0], b: typeof sessions[0]) => a.startAt.getTime() - b.startAt.getTime())
    const chosen = candidates[0]
    if (isAmbiguous) ambiguous++
    linked++
    updates.push(db.transaction.update({
      where: { id: t.id },
      data: {
        handledByUserId: chosen.userId,
        handledInSessionId: chosen.id,
        handlerAmbiguous: isAmbiguous,
      },
    }))
    if (updates.length >= 200) {
      await Promise.all(updates.splice(0))
    }
  }
  if (updates.length > 0) await Promise.all(updates)

  return { scanned: txs.length, linked, ambiguous, unlinked }
}
