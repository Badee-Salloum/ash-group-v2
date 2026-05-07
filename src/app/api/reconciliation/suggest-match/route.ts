import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole, TransactionStatus } from '@/lib/db/prisma-types'
import { isInternalTransfer } from '@/lib/reconciliation/walletMatch'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.ACCOUNT_MGR])

    const transactionId = req.nextUrl.searchParams.get('transactionId')
    if (!transactionId) return NextResponse.json({ error: 'معرّف العملية مطلوب' }, { status: 400 })

    // Find the source transaction
    const sourceTx = await db.transaction.findUnique({
      where: { id: transactionId },
      include: { account: { select: { name: true } } },
    })

    if (!sourceTx) return NextResponse.json({ error: 'العملية غير موجودة' }, { status: 404 })

    if (sourceTx.status !== TransactionStatus.PENDING_SC && sourceTx.status !== TransactionStatus.PENDING_P) {
      return NextResponse.json({ error: 'العملية ليست في حالة معلقة' }, { status: 400 })
    }

    // Opposite status: PENDING_SC ↔ PENDING_P (status-based, not source-based)
    const oppositeStatus = sourceTx.status === TransactionStatus.PENDING_SC
      ? TransactionStatus.PENDING_P
      : TransactionStatus.PENDING_SC

    // Time window: ±24 hours
    const dateFrom = new Date(sourceTx.txDateTime.getTime() - 24 * 60 * 60 * 1000)
    const dateTo = new Date(sourceTx.txDateTime.getTime() + 24 * 60 * 60 * 1000)

    // Find candidates — fetch all within time window and SAME currency
    // (no source filter — more lenient to catch edge cases)
    const candidatesRaw = await db.transaction.findMany({
      where: {
        accountId: sourceTx.accountId,
        type: sourceTx.type,
        status: oppositeStatus,
        currency: sourceTx.currency,
        matchedTxId: null,
        txDateTime: { gte: dateFrom, lte: dateTo },
        id: { not: sourceTx.id },
      },
      include: { account: { select: { name: true } } },
      orderBy: { txDateTime: 'asc' },
    })

    // Exclude internal transfers (our own wallets) — they must never be suggested
    // as matches for real customer operations.
    const account = await db.account.findUnique({
      where: { id: sourceTx.accountId },
      select: { walletIdentifiers: true },
    })
    const walletIds = account?.walletIdentifiers || []
    const candidates = candidatesRaw.filter((c: typeof candidatesRaw[0]) => {
      const raw = c.rawData as Record<string, unknown> | null
      if (!raw) return true
      return !isInternalTransfer(
        String(raw.accountNumber || ''),
        String(raw.accountName || ''),
        String(raw.notes || ''),
        walletIds
      )
    })

    const sourceAmount = Number(sourceTx.amount)

    const suggestions = candidates.map((candidate: typeof candidates[0]) => {
      const candidateAmount = Number(candidate.amount)
      const amountDiff = Math.abs(sourceAmount - candidateAmount)
      const timeDiffSeconds = Math.abs(sourceTx.txDateTime.getTime() - candidate.txDateTime.getTime()) / 1000

      // Confidence: 100% base, penalize for time and amount difference
      let confidence = 100
      // Time penalty: lose up to 30 points (24h = 30 points)
      confidence -= Math.min(30, (timeDiffSeconds / (24 * 3600)) * 30)
      // Amount penalty: lose up to 50 points based on % difference
      const amountPctDiff = sourceAmount > 0 ? (amountDiff / sourceAmount) * 100 : 100
      confidence -= Math.min(50, amountPctDiff * 2)
      // Exact amount bonus
      if (amountDiff < 0.01) confidence = Math.max(confidence, 95)

      confidence = Math.max(0, Math.min(100, Math.round(confidence)))

      return {
        matchId: candidate.id,
        matchSource: candidate.source,
        matchAmount: candidateAmount,
        matchCurrency: candidate.currency,
        matchDateTime: candidate.txDateTime.toISOString(),
        shamCashTxId: candidate.shamCashTxId,
        platformTxId: candidate.platformTxId,
        platformUserId: candidate.platformUserId,
        amountDiff: Math.round(amountDiff * 100) / 100,
        timeDiffSeconds: Math.round(timeDiffSeconds),
        confidence,
        rawData: candidate.rawData,
      }
    })

    // Sort by confidence descending and take top 50 best matches
    suggestions.sort((a: { confidence: number }, b: { confidence: number }) => b.confidence - a.confidence)
    const topSuggestions = suggestions.slice(0, 50)

    return NextResponse.json({
      success: true,
      source: {
        id: sourceTx.id,
        source: sourceTx.source,
        type: sourceTx.type,
        amount: sourceAmount,
        currency: sourceTx.currency,
        txDateTime: sourceTx.txDateTime.toISOString(),
        shamCashTxId: sourceTx.shamCashTxId,
        platformTxId: sourceTx.platformTxId,
        accountName: sourceTx.account.name,
      },
      suggestions: topSuggestions,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
