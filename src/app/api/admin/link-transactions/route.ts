import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { UserRole } from '@/lib/db/prisma-types'
import { linkTransactionsToEmployees } from '@/lib/reconciliation/employeeLinker'

// Manual trigger for Module D — re-link historical transactions to employees.
// POST /api/admin/link-transactions { accountId?, fromDate?, onlyUnlinked? }
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

  const body = await req.json().catch(() => ({}))
  const result = await linkTransactionsToEmployees({
    accountId: body.accountId,
    fromDate: body.fromDate ? new Date(body.fromDate) : undefined,
    onlyUnlinked: body.onlyUnlinked !== false,
  })

  await audit(session.userId, 'LINK_TRANSACTIONS_TO_EMPLOYEES', 'Transaction', null as unknown as string, result)
  return NextResponse.json({ success: true, ...result })
}
