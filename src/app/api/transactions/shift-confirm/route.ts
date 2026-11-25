import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { z } from 'zod'

// Independent from `reviewCategory` (accountant review) — this only marks
// that a SHIFT_MANAGER has looked at the row and it drops out of their
// queue. Reversible via ?undo=1 for the same manager.
const bodySchema = z.object({
  id: z.string().trim().min(1),
  undo: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.SHIFT_MANAGER, UserRole.ADMIN, UserRole.MANAGER])

    const { id, undo } = bodySchema.parse(await req.json())

    const tx = await db.transaction.findUnique({ where: { id }, select: { id: true, shiftConfirmedAt: true } })
    if (!tx) return NextResponse.json({ error: 'العملية غير موجودة' }, { status: 404 })

    await db.transaction.update({
      where: { id },
      data: undo
        ? { shiftConfirmedAt: null, shiftConfirmedById: null }
        : { shiftConfirmedAt: new Date(), shiftConfirmedById: session.userId },
    })
    await audit(session.userId, undo ? 'SHIFT_UNCONFIRM' : 'SHIFT_CONFIRM', 'Transaction', id, {})

    return NextResponse.json({ success: true, id })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
