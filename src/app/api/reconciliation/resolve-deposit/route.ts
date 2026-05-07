import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole, TransactionStatus } from '@/lib/db/prisma-types'
import { z } from 'zod'

const resolveSchema = z.object({
  depositTxId: z.string(),
  shamCashTxId: z.string(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.ACCOUNT_MGR])

    const body = await req.json()
    const { depositTxId, shamCashTxId } = resolveSchema.parse(body)

    // Find platform discrepancy deposit
    const platformTx = await db.transaction.findFirst({
      where: { id: depositTxId, status: TransactionStatus.DISCREPANCY, type: 'DEPOSIT' },
    })
    if (!platformTx) return NextResponse.json({ error: 'العملية غير موجودة أو ليست بحالة فارق' }, { status: 404 })

    // Find SC-only pending deposit
    const scTx = await db.transaction.findFirst({
      where: { shamCashTxId, status: TransactionStatus.PENDING_SC, type: 'DEPOSIT' },
    })
    if (!scTx) return NextResponse.json({ error: 'عملية شام كاش غير موجودة في قائمة المعلقة' }, { status: 404 })

    // Link both as matched
    await db.$transaction([
      db.transaction.update({
        where: { id: platformTx.id },
        data: { status: TransactionStatus.MATCHED, matchedTxId: scTx.id },
      }),
      db.transaction.update({
        where: { id: scTx.id },
        data: { status: TransactionStatus.MATCHED, matchedTxId: platformTx.id },
      }),
    ])

    await audit(session.userId, 'MANUAL_RESOLVE_DEPOSIT', 'Transaction', platformTx.id, {
      shamCashTxId, depositTxId,
    })

    return NextResponse.json({ success: true, message: 'تم ربط العمليتين بنجاح' })
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: error.issues[0]?.message || 'خطأ في البيانات' }, { status: 400 })
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
