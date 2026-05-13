import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole, TransactionStatus, TransactionSource } from '@/lib/db/prisma-types'
import { z } from 'zod'

// POST /api/reconciliation/unlink — break a previously-matched pair so each
// side returns to its appropriate PENDING_* bucket. Used from the customer
// page actions menu when a reviewer realizes two operations were linked in
// error (e.g., same amount, wrong customer).
//
// Both sides go back to:
//   - SHAM_CASH-source row → PENDING_SC
//   - PLATFORM-source row  → PENDING_P
// `matchedTxId` is cleared on both rows. `amountDiff` is cleared too because
// it only makes sense for a linked pair.
//
// Role: ADMIN | SUPERVISOR. Audits MANUAL_UNLINK with both ids.

const unlinkSchema = z.object({
  transactionId: z.string(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.SUPERVISOR])

    const body = await req.json()
    const { transactionId } = unlinkSchema.parse(body)

    const tx = await db.transaction.findUnique({
      where: { id: transactionId },
    })
    if (!tx) {
      return NextResponse.json({ error: 'العملية غير موجودة' }, { status: 404 })
    }
    if (tx.status !== TransactionStatus.MATCHED && tx.status !== TransactionStatus.DISCREPANCY) {
      return NextResponse.json(
        { error: 'العملية غير مرتبطة بعملية أخرى' },
        { status: 400 },
      )
    }
    if (!tx.matchedTxId) {
      return NextResponse.json(
        { error: 'العملية لا تحمل إشارة ربط' },
        { status: 400 },
      )
    }

    const partner = await db.transaction.findUnique({
      where: { id: tx.matchedTxId },
    })

    const newStatusFor = (source: string) =>
      source === TransactionSource.SHAM_CASH
        ? TransactionStatus.PENDING_SC
        : TransactionStatus.PENDING_P

    await db.$transaction([
      db.transaction.update({
        where: { id: tx.id },
        data: {
          status: newStatusFor(tx.source),
          matchedTxId: null,
          amountDiff: null,
        },
      }),
      ...(partner
        ? [
            db.transaction.update({
              where: { id: partner.id },
              data: {
                status: newStatusFor(partner.source),
                matchedTxId: null,
                amountDiff: null,
              },
            }),
          ]
        : []),
    ])

    await audit(session.userId, 'MANUAL_UNLINK', 'Transaction', tx.id, {
      partnerId: tx.matchedTxId,
      previousStatus: tx.status,
    })

    return NextResponse.json({
      success: true,
      message: 'تم فك الربط',
      data: { unlinked: [tx.id, tx.matchedTxId] },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || 'بيانات غير صالحة' },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
