import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { z } from 'zod'

const expenseSchema = z.object({
  description: z.string().min(1, 'الوصف مطلوب'),
  amount: z.number().positive('المبلغ يجب أن يكون موجباً'),
  category: z.string().optional(),
  expenseDate: z.string(),
})

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    if (session.role === UserRole.SUPERVISOR || session.role === UserRole.ACCOUNT_MGR) {
      return NextResponse.json({ error: 'غير مصرح بالوصول' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '50')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    const where = {
      deletedAt: null,
      ...(dateFrom || dateTo ? {
        expenseDate: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59') } : {}),
        },
      } : {}),
    }

    const [total, expenses] = await Promise.all([
      db.expense.count({ where }),
      db.expense.findMany({
        where,
        include: { createdBy: { select: { name: true } } },
        orderBy: { expenseDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return NextResponse.json({
      success: true,
      data: expenses,
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    })
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
    const data = expenseSchema.parse(body)

    const expense = await db.expense.create({
      data: {
        ...data,
        expenseDate: new Date(data.expenseDate),
        userId: session.userId,
      },
    })

    await audit(session.userId, 'CREATE_EXPENSE', 'Expense', expense.id, { amount: expense.amount })

    return NextResponse.json({ success: true, data: expense })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'خطأ في البيانات' }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const body = await req.json()
    const { id, ...data } = body
    const validated = expenseSchema.parse(data)

    const expense = await db.expense.update({
      where: { id },
      data: { ...validated, expenseDate: new Date(validated.expenseDate) },
    })

    await audit(session.userId, 'UPDATE_EXPENSE', 'Expense', id)

    return NextResponse.json({ success: true, data: expense })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const { id } = await req.json()
    await db.expense.update({ where: { id }, data: { deletedAt: new Date() } })
    await audit(session.userId, 'DELETE_EXPENSE', 'Expense', id)

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
