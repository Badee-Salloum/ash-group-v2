import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

export const runtime = 'nodejs'

const DETAIL_HEADERS = { 'Cache-Control': 'private, no-store' }

const transactionDetailSelect = {
  id: true,
  accountId: true,
  batchId: true,
  source: true,
  type: true,
  shamCashTxId: true,
  platformTxId: true,
  platformUserId: true,
  amount: true,
  currency: true,
  txDateTime: true,
  status: true,
  matchedTxId: true,
  amountDiff: true,
  rawData: true,
  customerName: true,
  isInternalTransferAuto: true,
  notes: true,
  reviewCategory: true,
  reviewNotes: true,
  reviewedBy: true,
  reviewedAt: true,
  followUpStatus: true,
  followUpAssignedTo: true,
  followUpResolution: true,
  followUpResolvedAt: true,
  followUpResolvedBy: true,
  handledByUserId: true,
  handledInSessionId: true,
  handlerAmbiguous: true,
  hasDelay: true,
  delayLoggedAt: true,
  shiftConfirmedAt: true,
  createdAt: true,
  updatedAt: true,
  account: { select: { id: true, name: true, currency: true } },
  matchedTx: {
    select: {
      id: true,
      source: true,
      type: true,
      shamCashTxId: true,
      platformTxId: true,
      platformUserId: true,
      amount: true,
      currency: true,
      txDateTime: true,
      status: true,
      amountDiff: true,
      rawData: true,
      customerName: true,
      isInternalTransferAuto: true,
      notes: true,
    },
  },
  handledByUser: { select: { id: true, name: true } },
  batch: {
    select: {
      id: true,
      batchDate: true,
      createdAt: true,
      uploader: { select: { id: true, name: true } },
    },
  },
} as const

async function detailAccountScope(userId: string, role: string): Promise<Record<string, unknown>> {
  if (role !== UserRole.ACCOUNT_MGR) return {}
  const access = await db.accountAccess.findMany({
    where: { userId },
    select: { accountId: true },
  }) as Array<{ accountId: string }>
  return { accountId: { in: access.map(row => row.accountId) } }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401, headers: DETAIL_HEADERS })
    if (session.role === UserRole.EMPLOYEE) {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403, headers: DETAIL_HEADERS })
    }

    const id = params.id?.trim()
    if (!id || id.length > 191) {
      return NextResponse.json({ error: 'معرّف العملية غير صالح' }, { status: 400, headers: DETAIL_HEADERS })
    }

    // Query with the account scope rather than loading by id and checking
    // afterwards, so an account manager cannot infer another account's data.
    const transaction = await db.transaction.findFirst({
      where: { id, ...(await detailAccountScope(session.userId, session.role)) },
      select: transactionDetailSelect,
    })
    if (!transaction) {
      return NextResponse.json({ error: 'العملية غير موجودة' }, { status: 404, headers: DETAIL_HEADERS })
    }

    return NextResponse.json({ success: true, data: transaction }, { headers: DETAIL_HEADERS })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500, headers: DETAIL_HEADERS })
  }
}
