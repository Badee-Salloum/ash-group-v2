import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { UserRole } from '@/lib/db/prisma-types'
import { resolveManualPair } from '@/lib/reconciliation/manualResolve'
import { z } from 'zod'

const resolveSchema = z.object({
  platformTxId: z.string(),   // DB id of platform DISCREPANCY transaction
  shamCashTxId: z.string(),   // shamCashTxId string from SC-only pending
})

// POST /api/reconciliation/resolve-withdrawal
export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.ACCOUNT_MGR])

    const body = await req.json()
    const { platformTxId, shamCashTxId } = resolveSchema.parse(body)

    const result = await resolveManualPair(platformTxId, shamCashTxId, 'WITHDRAWAL', session)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: error.issues[0]?.message || 'خطأ في البيانات' }, { status: 400 })
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
