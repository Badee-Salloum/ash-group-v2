import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { z } from 'zod'

const accountSchema = z.object({
  name: z.string().min(1),
  currency: z.string().default('USD'),
  depositProfitRate: z.number().min(0).max(100),
  withdrawalProfitRate: z.number().min(0).max(100),
  walletIdentifiers: z.array(z.string()).default([]),
})

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    let accounts
    if (session.role === UserRole.ACCOUNT_MGR) {
      const access = await db.accountAccess.findMany({ where: { userId: session.userId } })
      const ids = (access as any[]).map((a: any) => a.accountId)
      accounts = await db.account.findMany({ where: { id: { in: ids }, isActive: true } })
    } else {
      accounts = await db.account.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } })
    }

    // Hide financial values (profit rates) for SUPERVISOR and ACCOUNT_MGR
    const isRestricted = session.role === UserRole.SUPERVISOR || session.role === UserRole.ACCOUNT_MGR
    if (isRestricted) {
      accounts = (accounts as any[]).map((a: any) => ({
        ...a,
        depositProfitRate: undefined,
        withdrawalProfitRate: undefined,
      }))
    }

    return NextResponse.json({ success: true, data: accounts, isRestricted })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const body = await req.json()
    const data = accountSchema.parse(body)

    const account = await db.account.create({ data })
    await audit(session.userId, 'CREATE_ACCOUNT', 'Account', account.id)

    return NextResponse.json({ success: true, data: account })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || 'خطأ في البيانات' }, { status: 400 })
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const body = await req.json()
    const { id, ...rest } = body
    const data = accountSchema.parse(rest)

    // Save rate history if rates changed
    const existing = await db.account.findUniqueOrThrow({ where: { id } })
    if (
      Number(existing.depositProfitRate) !== data.depositProfitRate ||
      Number(existing.withdrawalProfitRate) !== data.withdrawalProfitRate
    ) {
      await db.profitRateHistory.create({
        data: {
          accountId: id,
          depositProfitRate: data.depositProfitRate,
          withdrawalProfitRate: data.withdrawalProfitRate,
          changedBy: session.userId,
        },
      })
    }

    const account = await db.account.update({ where: { id }, data })
    await audit(session.userId, 'UPDATE_ACCOUNT', 'Account', id)

    return NextResponse.json({ success: true, data: account })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
