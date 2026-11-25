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

  let linked = 0, ambiguous = 0, unlinked = 0
  let scanned = 0
  let afterId: string | undefined
  const pageSize = 2_000
  const updateBatchSize = 100

  // A manual historical relink used to silently stop after 50,000 records.
  // Walk a stable id cursor instead: memory, session lookup windows, and
  // writes stay bounded regardless of the transaction-table size.
  for (;;) {
    const pageWhere = afterId
      ? { AND: [where, { id: { gt: afterId } }] }
      : where
    const txs = await db.transaction.findMany({
      where: pageWhere,
      select: { id: true, accountId: true, txDateTime: true },
      orderBy: { id: 'asc' },
      take: pageSize,
    }) as Array<{ id: string; accountId: string; txDateTime: Date }>
    if (txs.length === 0) break
    scanned += txs.length

    // Pre-load only sessions that overlap this page's time window.
    const minTime = txs.reduce((minimum, tx) => tx.txDateTime < minimum ? tx.txDateTime : minimum, txs[0].txDateTime)
    const maxTime = txs.reduce((maximum, tx) => tx.txDateTime > maximum ? tx.txDateTime : maximum, txs[0].txDateTime)
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

    const byWallet = new Map<string, typeof sessions>()
    for (const session of sessions) {
      for (const wallet of session.wallets) {
        if (!byWallet.has(wallet.accountId)) byWallet.set(wallet.accountId, [])
        byWallet.get(wallet.accountId)!.push(session)
      }
    }

    const updates: Array<Promise<unknown>> = []
    for (const tx of txs) {
      const candidates = (byWallet.get(tx.accountId) || []).filter((session: typeof sessions[number]) => {
        const startsBefore = session.startAt <= tx.txDateTime
        const endsAfter = !session.endAt || session.endAt >= tx.txDateTime
        return startsBefore && endsAfter
      })
      if (candidates.length === 0) {
        unlinked++
        continue
      }
      const isAmbiguous = candidates.length > 1
      candidates.sort((a: typeof sessions[number], b: typeof sessions[number]) => a.startAt.getTime() - b.startAt.getTime())
      const chosen = candidates[0]
      if (isAmbiguous) ambiguous++
      linked++
      updates.push(db.transaction.update({
        where: { id: tx.id },
        data: {
          handledByUserId: chosen.userId,
          handledInSessionId: chosen.id,
          handlerAmbiguous: isAmbiguous,
        },
      }))
      if (updates.length >= updateBatchSize) {
        await db.$transaction(updates.splice(0))
      }
    }
    if (updates.length > 0) await db.$transaction(updates)

    afterId = txs[txs.length - 1].id
    if (txs.length < pageSize) break
  }

  return { scanned, linked, ambiguous, unlinked }
}
