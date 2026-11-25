import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { z } from 'zod'

// SHIFT_MANAGER (and admin/manager) tags a transaction as "delayed". The
// concept is binary — no duration, no severity. The reference can be either
// the ShamCash Tx ID or the Platform Tx ID. First match wins.
const bodySchema = z.object({
  ref: z.string().trim().min(1, 'أدخل رقم شام كاش أو رقم المنصة'),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.SHIFT_MANAGER, UserRole.ADMIN, UserRole.MANAGER])

    const { ref } = bodySchema.parse(await req.json())

    const tx = await db.transaction.findFirst({
      where: {
        OR: [{ shamCashTxId: ref }, { platformTxId: ref }],
      },
      select: { id: true, shamCashTxId: true, platformTxId: true, hasDelay: true },
    })
    if (!tx) return NextResponse.json({ error: 'لم يُعثر على العملية' }, { status: 404 })
    if (tx.hasDelay) return NextResponse.json({ error: 'التأخير مُسجَّل مسبقاً على هذه العملية' }, { status: 400 })

    await db.transaction.update({
      where: { id: tx.id },
      data: { hasDelay: true, delayLoggedById: session.userId, delayLoggedAt: new Date() },
    })
    await audit(session.userId, 'LOG_DELAY', 'Transaction', tx.id, { ref })

    return NextResponse.json({ success: true, id: tx.id })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
