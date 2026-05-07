import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole, TransactionStatus } from '@/lib/db/prisma-types'
import { z } from 'zod'

const confirmSchema = z.object({
  transactionId: z.string(),
  matchId: z.string(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.ACCOUNT_MGR])

    const body = await req.json()
    const { transactionId, matchId } = confirmSchema.parse(body)

    // Fetch both transactions
    const [tx1, tx2] = await Promise.all([
      db.transaction.findUnique({ where: { id: transactionId } }),
      db.transaction.findUnique({ where: { id: matchId } }),
    ])

    if (!tx1 || !tx2) {
      return NextResponse.json({ error: 'إحدى العمليتين غير موجودة' }, { status: 404 })
    }

    // Validate both are pending
    const validStatuses = [TransactionStatus.PENDING_SC, TransactionStatus.PENDING_P]
    if (!validStatuses.includes(tx1.status) || !validStatuses.includes(tx2.status)) {
      return NextResponse.json({ error: 'كلتا العمليتين يجب أن تكونا في حالة معلقة' }, { status: 400 })
    }

    // Validate same account and type
    if (tx1.accountId !== tx2.accountId) {
      return NextResponse.json({ error: 'العمليتان يجب أن تكونا من نفس الحساب' }, { status: 400 })
    }
    if (tx1.type !== tx2.type) {
      return NextResponse.json({ error: 'العمليتان يجب أن تكونا من نفس النوع' }, { status: 400 })
    }

    // Validate opposite sources
    if (tx1.source === tx2.source) {
      return NextResponse.json({ error: 'العمليتان يجب أن تكونا من مصدرين مختلفين' }, { status: 400 })
    }

    // Validate same currency
    if (tx1.currency !== tx2.currency) {
      return NextResponse.json({ error: `العمليتان بعملات مختلفة (${tx1.currency} vs ${tx2.currency})` }, { status: 400 })
    }

    // Calculate amount difference
    const amount1 = Number(tx1.amount)
    const amount2 = Number(tx2.amount)
    const amountDiff = Math.round(Math.abs(amount1 - amount2) * 100) / 100

    // Determine final status
    const finalStatus = amountDiff < 0.01 ? TransactionStatus.MATCHED : TransactionStatus.DISCREPANCY

    // Update both transactions
    await db.$transaction([
      db.transaction.update({
        where: { id: tx1.id },
        data: {
          status: finalStatus,
          matchedTxId: tx2.id,
          amountDiff: amountDiff > 0.01 ? amountDiff : null,
          notes: tx1.notes
            ? `${tx1.notes}\n[ربط يدوي]`
            : '[ربط يدوي]',
        },
      }),
      db.transaction.update({
        where: { id: tx2.id },
        data: {
          status: finalStatus,
          matchedTxId: tx1.id,
          amountDiff: amountDiff > 0.01 ? amountDiff : null,
          notes: tx2.notes
            ? `${tx2.notes}\n[ربط يدوي]`
            : '[ربط يدوي]',
        },
      }),
    ])

    await audit(session.userId, 'MANUAL_LINK_CONFIRM', 'Transaction', tx1.id, {
      tx1Id: tx1.id,
      tx2Id: tx2.id,
      tx1Amount: amount1,
      tx2Amount: amount2,
      amountDiff,
      finalStatus,
    })

    return NextResponse.json({
      success: true,
      message: amountDiff < 0.01
        ? 'تم ربط العمليتين كمطابقة تامة'
        : `تم ربط العمليتين بفارق ${amountDiff.toFixed(2)}`,
      data: { tx1Id: tx1.id, tx2Id: tx2.id, amountDiff, status: finalStatus },
    })
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: error.issues[0]?.message || 'خطأ في البيانات' }, { status: 400 })
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
