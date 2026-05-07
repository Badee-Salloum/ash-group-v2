import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { TransactionStatus } from '@/lib/db/prisma-types'
import { isInternalTransfer } from '@/lib/reconciliation/walletMatch'

// Returns best-match info for a list of PENDING transactions
// POST body: { transactionIds: string[] }
// Response: { data: { [txId]: { timeDiffSeconds, amountDiff, confidence } | null } }

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const body = await req.json()
    const txIds: string[] = body.transactionIds || []
    if (txIds.length === 0) return NextResponse.json({ success: true, data: {} })

    // Fetch the source transactions
    const sourceTxs = await db.transaction.findMany({
      where: {
        id: { in: txIds },
        status: { in: [TransactionStatus.PENDING_SC, TransactionStatus.PENDING_P] },
        matchedTxId: null,
      },
      select: {
        id: true, accountId: true, type: true, source: true, status: true,
        amount: true, txDateTime: true, currency: true,
      },
    })

    if (sourceTxs.length === 0) return NextResponse.json({ success: true, data: {} })

    // Group source transactions by accountId for efficient candidate lookup
    const accountIds = Array.from(new Set(sourceTxs.map((t: { accountId: string }) => t.accountId)))

    // Fetch ALL pending transactions in these accounts (both PENDING_SC and PENDING_P)
    const allPendingRaw = await db.transaction.findMany({
      where: {
        accountId: { in: accountIds },
        status: { in: [TransactionStatus.PENDING_SC, TransactionStatus.PENDING_P] },
        matchedTxId: null,
      },
      select: {
        id: true, accountId: true, type: true, source: true, status: true,
        amount: true, txDateTime: true, currency: true, rawData: true,
      },
    })

    // Exclude internal transfers (our own wallets) from candidate pool
    const accounts = await db.account.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, walletIdentifiers: true },
    })
    const walletMap = new Map<string, string[]>(
      accounts.map((a: { id: string; walletIdentifiers: string[] }) => [a.id, a.walletIdentifiers || []])
    )
    const allPending = allPendingRaw.filter((t: typeof allPendingRaw[0]) => {
      const walletIds = walletMap.get(t.accountId) || []
      if (walletIds.length === 0) return true
      const raw = t.rawData as Record<string, unknown> | null
      if (!raw) return true
      return !isInternalTransfer(
        String(raw.accountNumber || ''),
        String(raw.accountName || ''),
        String(raw.notes || ''),
        walletIds
      )
    })

    // Build a map for efficient lookup by (accountId, type, source, status)
    // For each source tx, we want opposite source & status
    const result: Record<string, { timeDiffSeconds: number; amountDiff: number; confidence: number } | null> = {}

    for (const src of sourceTxs) {
      const oppositeStatus = src.status === TransactionStatus.PENDING_SC
        ? TransactionStatus.PENDING_P
        : TransactionStatus.PENDING_SC

      // Find candidates within 24h window AND same currency (status-based, source-agnostic)
      const candidates = allPending.filter((c: typeof allPending[0]) =>
        c.accountId === src.accountId &&
        c.type === src.type &&
        c.status === oppositeStatus &&
        c.currency === src.currency &&
        c.id !== src.id
      )

      const srcAmount = Number(src.amount)
      let best: { timeDiffSeconds: number; amountDiff: number; confidence: number } | null = null

      for (const c of candidates) {
        const timeDiffSeconds = Math.abs(src.txDateTime.getTime() - c.txDateTime.getTime()) / 1000
        if (timeDiffSeconds > 24 * 3600) continue

        const candAmount = Number(c.amount)
        const amountDiff = Math.abs(srcAmount - candAmount)

        // Confidence calculation (same as suggest-match)
        let confidence = 100
        confidence -= Math.min(30, (timeDiffSeconds / (24 * 3600)) * 30)
        const amountPctDiff = srcAmount > 0 ? (amountDiff / srcAmount) * 100 : 100
        confidence -= Math.min(50, amountPctDiff * 2)
        if (amountDiff < 0.01) confidence = Math.max(confidence, 95)
        confidence = Math.max(0, Math.min(100, Math.round(confidence)))

        if (!best || confidence > best.confidence) {
          best = {
            timeDiffSeconds: Math.round(timeDiffSeconds),
            amountDiff: Math.round(amountDiff * 100) / 100,
            confidence,
          }
        }
      }

      result[src.id] = best
    }

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
