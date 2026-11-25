import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { TransactionStatus, UserRole } from '@/lib/db/prisma-types'

const MAX_TRANSACTION_IDS = 100
const CANDIDATES_PER_SOURCE = 50
const MAX_CONCURRENT_CANDIDATE_QUERIES = 8
const DAY_MS = 24 * 60 * 60 * 1000

type SourceTransaction = {
  id: string
  accountId: string
  type: string
  status: string
  amount: unknown
  txDateTime: Date
  currency: string
}

type CandidateTransaction = {
  id: string
  amount: unknown
  txDateTime: Date
}

type MatchInfo = {
  timeDiffSeconds: number
  amountDiff: number
  confidence: number
} | null

async function scopedAccountFilter(userId: string, role: string): Promise<Record<string, unknown>> {
  if (role !== UserRole.ACCOUNT_MGR) return {}
  const access = await db.accountAccess.findMany({
    where: { userId },
    select: { accountId: true },
  }) as Array<{ accountId: string }>
  return { accountId: { in: access.map(row => row.accountId) } }
}

function bestCandidate(source: SourceTransaction, candidates: CandidateTransaction[]): MatchInfo {
  const sourceAmount = Number(source.amount)
  let best: MatchInfo = null

  for (const candidate of candidates) {
    const timeDiffSeconds = Math.abs(source.txDateTime.getTime() - candidate.txDateTime.getTime()) / 1000
    if (timeDiffSeconds > DAY_MS / 1000) continue

    const amountDiff = Math.abs(sourceAmount - Number(candidate.amount))
    let confidence = 100
    confidence -= Math.min(30, (timeDiffSeconds / (DAY_MS / 1000)) * 30)
    const amountPctDiff = sourceAmount > 0 ? (amountDiff / sourceAmount) * 100 : 100
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

  return best
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length)
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++
      result[index] = await mapper(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  return result
}

// Returns best-match info for a small, visible page of PENDING transactions.
// POST body: { transactionIds: string[] }
// Response: { data: { [txId]: { timeDiffSeconds, amountDiff, confidence } | null } }
export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const body = await req.json() as { transactionIds?: unknown }
    if (!Array.isArray(body.transactionIds)) {
      return NextResponse.json({ error: 'transactionIds يجب أن تكون قائمة' }, { status: 400 })
    }
    const txIds = Array.from(new Set(
      body.transactionIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 191),
    ))
    if (txIds.length > MAX_TRANSACTION_IDS) {
      return NextResponse.json(
        { error: `الحد الأقصى هو ${MAX_TRANSACTION_IDS} عملية لكل طلب` },
        { status: 400 },
      )
    }
    if (txIds.length === 0) return NextResponse.json({ success: true, data: {} })

    const accountFilter = await scopedAccountFilter(session.userId, session.role)
    const sourceTxs = await db.transaction.findMany({
      where: {
        id: { in: txIds },
        status: { in: [TransactionStatus.PENDING_SC, TransactionStatus.PENDING_P] },
        matchedTxId: null,
        ...accountFilter,
      },
      select: {
        id: true,
        accountId: true,
        type: true,
        status: true,
        amount: true,
        txDateTime: true,
        currency: true,
      },
    }) as SourceTransaction[]

    const matches = await mapWithConcurrency(
      sourceTxs,
      MAX_CONCURRENT_CANDIDATE_QUERIES,
      async source => {
        const oppositeStatus = source.status === TransactionStatus.PENDING_SC
          ? TransactionStatus.PENDING_P
          : TransactionStatus.PENDING_SC
        const from = new Date(source.txDateTime.getTime() - DAY_MS)
        const to = new Date(source.txDateTime.getTime() + DAY_MS)

        // Bound every candidate query. The old implementation loaded every
        // pending row for all touched accounts (including rawData) then did an
        // O(source × pending) in-memory scan.
        const candidates = await db.transaction.findMany({
          where: {
            AND: [
              {
                accountId: source.accountId,
                type: source.type,
                status: oppositeStatus,
                currency: source.currency,
                matchedTxId: null,
                txDateTime: { gte: from, lte: to },
                id: { not: source.id },
              },
              { OR: [{ notes: null }, { notes: { not: 'internal-transfer' } }] },
              { OR: [{ reviewCategory: null }, { reviewCategory: { not: 'INTERNAL_TRANSFER' } }] },
            ],
          },
          select: { id: true, amount: true, txDateTime: true },
          orderBy: { txDateTime: 'asc' },
          take: CANDIDATES_PER_SOURCE,
        }) as CandidateTransaction[]

        return { id: source.id, match: bestCandidate(source, candidates) }
      },
    )

    const data: Record<string, MatchInfo> = {}
    for (const id of txIds) data[id] = null
    for (const { id, match } of matches) data[id] = match

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
