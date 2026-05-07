import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

// List all employees (Phase 2 — Module A).
// Returns User rows with employee fields + manager info + subordinate count.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const includeInactive = req.nextUrl.searchParams.get('includeInactive') === '1'
    // MANAGER (مدير فرع) only sees EMPLOYEE-tier accounts.
    const isManagerScope = session.role === UserRole.MANAGER
    const baseWhere: Record<string, unknown> = includeInactive ? {} : { isActive: true }
    if (isManagerScope) baseWhere.role = UserRole.EMPLOYEE
    const employees = await db.user.findMany({
      where: baseWhere as never,
      include: {
        manager: { select: { id: true, name: true, jobTitle: true } },
        _count: { select: { subordinates: true } },
      },
      orderBy: [{ isActive: 'desc' }, { jobTitle: 'asc' }, { name: 'asc' }],
    })

    const data = employees.map((u: any) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      employeeCode: u.employeeCode,
      jobTitle: u.jobTitle,
      hireDate: u.hireDate,
      baseSalary: u.baseSalary ? Number(u.baseSalary) : null,
      phone: u.phone,
      address: u.address,
      avatarUrl: u.avatarUrl,
      managerId: u.managerId,
      manager: u.manager,
      subordinateCount: u._count.subordinates,
      isActive: u.isActive,
    }))

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8).optional(),  // optional — admin can create without password (employee uses code login)
  role: z.enum(['ADMIN', 'SUPERVISOR', 'ACCOUNT_MGR', 'MANAGER', 'EMPLOYEE']).default('EMPLOYEE'),
  employeeCode: z.string().min(1).optional(),
  jobTitle: z.string().optional(),
  hireDate: z.string().optional(),
  baseSalary: z.number().nonnegative().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
  managerId: z.string().optional().nullable(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const body = await req.json()
    const data = createSchema.parse(body)

    // MANAGER (مدير فرع) is restricted to creating EMPLOYEE-tier accounts only.
    if (session.role === UserRole.MANAGER && data.role !== 'EMPLOYEE') {
      return NextResponse.json({ error: 'مدير الفرع يستطيع إضافة حسابات موظف فقط' }, { status: 403 })
    }

    // Auto-generate employee code if not provided
    let employeeCode = data.employeeCode
    if (!employeeCode) {
      const count = await db.user.count()
      employeeCode = `EMP-${String(count + 1).padStart(4, '0')}`
    }

    const passwordHash = await bcrypt.hash(data.password || `${employeeCode}@temp123`, 10)

    // If a soft-deleted user already exists with this email, reactivate them
    // in place rather than rejecting with a unique-constraint error. The admin
    // workflow expects "create" to be idempotent for previously-disabled users.
    const existingByEmail = await db.user.findUnique({ where: { email: data.email } })
    if (existingByEmail && !existingByEmail.isActive) {
      const reactivateData: Record<string, unknown> = {
        isActive: true,
        name: data.name,
        role: data.role,
        passwordHash,
        employeeCode,
        jobTitle: data.jobTitle ?? existingByEmail.jobTitle,
        hireDate: data.hireDate ? new Date(data.hireDate) : existingByEmail.hireDate,
        baseSalary: data.baseSalary ?? existingByEmail.baseSalary,
        phone: data.phone ?? existingByEmail.phone,
        address: data.address ?? existingByEmail.address,
        avatarUrl: data.avatarUrl || existingByEmail.avatarUrl || undefined,
      }
      if (data.managerId) {
        reactivateData.manager = { connect: { id: data.managerId } }
      }
      const reactivated = await db.user.update({
        where: { id: existingByEmail.id },
        data: reactivateData as never,
      })
      await audit(session.userId, 'REACTIVATE_EMPLOYEE', 'User', reactivated.id, { email: data.email })
      return NextResponse.json({ success: true, reactivated: true, data: { id: reactivated.id, employeeCode } })
    }
    if (existingByEmail) {
      return NextResponse.json({ error: 'البريد الإلكتروني مستخدم مسبقاً' }, { status: 400 })
    }

    // NOTE: use `manager: { connect: { id } }` for the relation rather than
    // setting `managerId` directly — newer Prisma generated types reject the
    // scalar form when a relation is declared. weeklyOffDays is omitted until
    // the DB schema is migrated (`prisma db push`).
    const createData: Record<string, unknown> = {
      name: data.name,
      email: data.email,
      passwordHash,
      role: data.role,
      employeeCode,
      jobTitle: data.jobTitle,
      hireDate: data.hireDate ? new Date(data.hireDate) : undefined,
      baseSalary: data.baseSalary,
      phone: data.phone,
      address: data.address,
      avatarUrl: data.avatarUrl || undefined,
    }
    if (data.managerId) {
      createData.manager = { connect: { id: data.managerId } }
    }
    const user = await db.user.create({ data: createData as never })

    await audit(session.userId, 'CREATE_EMPLOYEE', 'User', user.id, { employeeCode, role: data.role })
    return NextResponse.json({ success: true, data: { id: user.id, employeeCode } })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    // Translate common Prisma errors to clean Arabic messages
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('Unique constraint') && msg.includes('email')) {
      return NextResponse.json({ error: 'البريد الإلكتروني مستخدم مسبقاً' }, { status: 400 })
    }
    if (msg.includes('Unique constraint') && msg.includes('employeeCode')) {
      return NextResponse.json({ error: 'رمز الموظف مستخدم مسبقاً — استخدم رمزاً مختلفاً' }, { status: 400 })
    }
    if (msg.includes('Foreign key constraint')) {
      return NextResponse.json({ error: 'المدير المختار غير موجود — حدّث الصفحة وحاول مجدداً' }, { status: 400 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

const updateSchema = createSchema.partial().extend({ id: z.string() })

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const body = await req.json()
    const data = updateSchema.parse(body)
    const { id, password, ...rest } = data

    // MANAGER scope: can only edit existing EMPLOYEE accounts and cannot
    // promote them to a higher tier.
    if (session.role === UserRole.MANAGER) {
      const target = await db.user.findUnique({ where: { id }, select: { role: true } })
      if (!target) return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 })
      if (target.role !== UserRole.EMPLOYEE) {
        return NextResponse.json({ error: 'مدير الفرع يستطيع تعديل حسابات الموظفين فقط' }, { status: 403 })
      }
      if (rest.role && rest.role !== 'EMPLOYEE') {
        return NextResponse.json({ error: 'لا يمكن لمدير الفرع تغيير دور الموظف' }, { status: 403 })
      }
    }

    // Prevent assigning self as own manager (cycle)
    if (rest.managerId === id) {
      return NextResponse.json({ error: 'لا يمكن للموظف أن يكون مديراً لنفسه' }, { status: 400 })
    }

    // Prevent picking a (direct or indirect) subordinate as manager — would create a cycle
    if (rest.managerId) {
      const all = await db.user.findMany({ select: { id: true, managerId: true } })
      const descendants = new Set<string>([id])
      let changed = true
      while (changed) {
        changed = false
        for (const u of all) {
          if (u.managerId && descendants.has(u.managerId) && !descendants.has(u.id)) {
            descendants.add(u.id); changed = true
          }
        }
      }
      if (descendants.has(rest.managerId)) {
        return NextResponse.json({ error: 'لا يمكن اختيار مرؤوس (مباشر أو غير مباشر) كمدير.' }, { status: 400 })
      }
    }

    const updateData: Record<string, unknown> = { ...rest }
    if (rest.hireDate) updateData.hireDate = new Date(rest.hireDate)
    if (password) updateData.passwordHash = await bcrypt.hash(password, 10)

    // Convert managerId scalar to relation form (Prisma checked-input requires it)
    if ('managerId' in updateData) {
      const mid = updateData.managerId
      delete updateData.managerId
      if (mid && typeof mid === 'string') {
        updateData.manager = { connect: { id: mid } }
      } else if (mid === null) {
        updateData.manager = { disconnect: true }
      }
    }

    await db.user.update({ where: { id }, data: updateData as never })
    await audit(session.userId, 'UPDATE_EMPLOYEE', 'User', id, rest)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('Unique constraint') && msg.includes('email')) {
      return NextResponse.json({ error: 'البريد الإلكتروني مستخدم مسبقاً' }, { status: 400 })
    }
    if (msg.includes('Unique constraint') && msg.includes('employeeCode')) {
      return NextResponse.json({ error: 'رمز الموظف مستخدم مسبقاً' }, { status: 400 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id مطلوب' }, { status: 400 })
    if (id === session.userId) {
      return NextResponse.json({ error: 'لا يمكنك حذف حسابك الخاص' }, { status: 400 })
    }

    // Soft-delete: deactivate + clear hierarchy links so subordinates aren't orphaned
    await db.user.updateMany({
      where: { managerId: id },
      data: { managerId: null },
    })
    await db.user.update({ where: { id }, data: { isActive: false, managerId: null } })

    await audit(session.userId, 'DELETE_EMPLOYEE', 'User', id, {})
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
