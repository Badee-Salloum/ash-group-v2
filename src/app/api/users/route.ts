import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, hashPassword, validatePasswordStrength, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { z } from 'zod'

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.nativeEnum(UserRole),
  accountIds: z.array(z.string()).default([]),
})

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const users = await db.user.findMany({
      select: {
        id: true, name: true, email: true, role: true,
        isActive: true, lastLoginAt: true, createdAt: true,
        twoFactorEnabled: true,
        accountAccess: { include: { account: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ success: true, data: users })
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
    const data = createUserSchema.parse(body)

    const pwCheck = validatePasswordStrength(data.password)
    if (!pwCheck.valid) return NextResponse.json({ error: pwCheck.message }, { status: 400 })

    const existing = await db.user.findUnique({
      where: { email: data.email },
      select: { id: true },
    })
    if (existing) return NextResponse.json({ error: 'البريد الإلكتروني مستخدم مسبقاً' }, { status: 400 })

    const user = await db.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: await hashPassword(data.password),
        role: data.role,
        accountAccess: {
          create: data.accountIds.map(accountId => ({ accountId })),
        },
      },
      select: { id: true, name: true },
    })

    await audit(session.userId, 'CREATE_USER', 'User', user.id, { role: data.role })
    return NextResponse.json({ success: true, data: { id: user.id, name: user.name } })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || 'خطأ في البيانات' }, { status: 400 })
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const body = await req.json()
    const { id, hard } = body
    if (!id) return NextResponse.json({ error: 'معرّف المستخدم مطلوب' }, { status: 400 })

    // Don't allow deleting self
    if (id === session.userId) {
      return NextResponse.json({ error: 'لا يمكنك حذف حسابك الخاص' }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } })
    if (!user) return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 })

    if (hard) {
      // Permanent delete — remove all related records
      await db.$transaction([
        db.accountAccess.deleteMany({ where: { userId: id } }),
        // Audit logs reference user but allow null userId, so just nullify them
        db.auditLog.updateMany({ where: { userId: id }, data: { userId: null } }),
        // Expenses reference user (required) — we need to handle these
        // Since expenses.userId is required, we need a fallback or block deletion
        db.user.delete({ where: { id } }),
      ])
      await audit(session.userId, 'HARD_DELETE_USER', 'User', id, { name: user.name, email: user.email })
      return NextResponse.json({ success: true, message: `تم حذف المستخدم ${user.name} نهائياً` })
    } else {
      // Soft delete (deactivate)
      await db.user.update({ where: { id }, data: { isActive: false } })
      await audit(session.userId, 'DEACTIVATE_USER', 'User', id, { name: user.name })
      return NextResponse.json({ success: true, message: `تم تعطيل المستخدم ${user.name}` })
    }
  } catch (error) {
    const errMsg = String(error)
    if (errMsg.includes('Foreign key constraint') || errMsg.includes('expenses')) {
      return NextResponse.json({
        error: 'لا يمكن حذف المستخدم نهائياً لوجود سجلات صرفيات مرتبطة به. استخدم خيار التعطيل بدلاً من ذلك.',
      }, { status: 400 })
    }
    return NextResponse.json({ error: errMsg }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const body = await req.json()
    const { id, accountIds, password, ...rest } = body

    const updateData: Record<string, unknown> = { ...rest }
    if (password) {
      const pwCheck = validatePasswordStrength(password)
      if (!pwCheck.valid) return NextResponse.json({ error: pwCheck.message }, { status: 400 })
      updateData.passwordHash = await hashPassword(password)
    }

    await db.$transaction([
      db.user.update({ where: { id }, data: updateData, select: { id: true } }),
      db.accountAccess.deleteMany({ where: { userId: id } }),
      ...(accountIds?.length ? [
        db.accountAccess.createMany({
          data: accountIds.map((accountId: string) => ({ userId: id, accountId })),
        })
      ] : []),
    ])

    await audit(session.userId, 'UPDATE_USER', 'User', id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
