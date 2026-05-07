import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

// Module C: per-employee wallet assignment.
// GET → list assigned account IDs.  PUT → replace the full set.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const list = await db.employeeWalletAssignment.findMany({
    where: { userId: params.id },
    include: { account: { select: { id: true, name: true, currency: true } } },
  })
  return NextResponse.json({
    success: true,
    data: list.map((a: typeof list[0]) => ({ id: a.id, account: a.account })),
  })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const body = await req.json()
    const accountIds: string[] = Array.isArray(body.accountIds) ? body.accountIds : []
    const userId = params.id

    await db.$transaction([
      db.employeeWalletAssignment.deleteMany({ where: { userId } }),
      db.employeeWalletAssignment.createMany({
        data: accountIds.map((accountId: string) => ({ userId, accountId })),
        skipDuplicates: true,
      }),
    ])

    await audit(session.userId, 'UPDATE_EMPLOYEE_WALLETS', 'User', userId, { accountIds })
    return NextResponse.json({ success: true, count: accountIds.length })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
