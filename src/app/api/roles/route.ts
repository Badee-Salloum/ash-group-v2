import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { ROLE_DEFAULT_PERMISSIONS } from '@/lib/permissions/roleDefaults'
import { z } from 'zod'

// Custom roles management. The CustomRole / RolePermission tables may not yet
// exist in the DB (awaiting `prisma db push`); when missing, GET still returns
// the system roles synthesized from ROLE_DEFAULT_PERMISSIONS so the UI works.

interface RoleDTO {
  id: string
  name: string
  displayName: string
  description: string | null
  isSystemRole: boolean
  isActive: boolean
  permissions: string[]
  isLegacy?: boolean
  assignedCount?: number
}

function legacyRoles(): RoleDTO[] {
  const enumRoles: UserRole[] = ['ADMIN', 'MANAGER', 'SUPERVISOR', 'ACCOUNT_MGR', 'EMPLOYEE']
  const labels: Record<UserRole, string> = {
    ADMIN: 'مدير عام',
    MANAGER: 'مدير فرع',
    SUPERVISOR: 'مشرف',
    ACCOUNT_MGR: 'مدير حساب',
    EMPLOYEE: 'موظف',
  }
  return enumRoles.map(r => ({
    id: `legacy:${r}`,
    name: r,
    displayName: labels[r],
    description: 'دور افتراضي مدمج في النظام',
    isSystemRole: true,
    isActive: true,
    permissions: [...ROLE_DEFAULT_PERMISSIONS[r]],
    isLegacy: true,
  }))
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  requireRole(session, [UserRole.ADMIN])

  const roles: RoleDTO[] = legacyRoles()

  // Try to load custom roles — table may not exist yet.
  try {
    const customDb = (db as unknown as { customRole?: { findMany: (args: unknown) => Promise<unknown> } }).customRole
    if (customDb) {
      const custom = await customDb.findMany({
        include: { permissions: true, _count: { select: { assignments: true } } },
        orderBy: { createdAt: 'asc' },
      }) as Array<{
        id: string; name: string; displayName: string; description: string | null;
        isSystemRole: boolean; isActive: boolean;
        permissions: Array<{ permissionKey: string }>;
        _count: { assignments: number };
      }>
      for (const r of custom) {
        roles.push({
          id: r.id, name: r.name, displayName: r.displayName, description: r.description,
          isSystemRole: r.isSystemRole, isActive: r.isActive,
          permissions: r.permissions.map(p => p.permissionKey),
          assignedCount: r._count.assignments,
        })
      }
    }
  } catch {
    // Table doesn't exist yet → return only legacy roles
  }

  return NextResponse.json({ success: true, data: roles })
}

const createSchema = z.object({
  name: z.string().min(2).regex(/^[A-Z_][A-Z0-9_]*$/, 'الاسم بأحرف كبيرة وشُرَط فقط (مثل: BRANCH_MANAGER)'),
  displayName: z.string().min(2),
  description: z.string().optional(),
  permissions: z.array(z.string()).default([]),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const body = await req.json()
    const data = createSchema.parse(body)

    const customDb = (db as unknown as { customRole?: {
      create: (args: unknown) => Promise<{ id: string }>;
      findUnique: (args: unknown) => Promise<unknown>;
    } }).customRole
    if (!customDb) {
      return NextResponse.json({
        error: 'جداول الأدوار المخصّصة لم تُنشأ بعد. شغّل: npx prisma db push',
      }, { status: 503 })
    }

    const created = await customDb.create({
      data: {
        name: data.name,
        displayName: data.displayName,
        description: data.description,
        permissions: { create: data.permissions.map(k => ({ permissionKey: k })) },
      },
    })
    await audit(session.userId, 'CREATE_ROLE', 'CustomRole', created.id, { name: data.name })
    return NextResponse.json({ success: true, id: created.id })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

const updateSchema = z.object({
  id: z.string(),
  displayName: z.string().min(2).optional(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  permissions: z.array(z.string()).optional(),
})

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const body = await req.json()
    const data = updateSchema.parse(body)

    const customDb = (db as unknown as { customRole?: {
      update: (args: unknown) => Promise<unknown>;
    } }).customRole
    const permsDb = (db as unknown as { rolePermission?: {
      deleteMany: (args: unknown) => Promise<unknown>;
      createMany: (args: unknown) => Promise<unknown>;
    } }).rolePermission

    if (!customDb || !permsDb) {
      return NextResponse.json({
        error: 'جداول الأدوار المخصّصة لم تُنشأ بعد. شغّل: npx prisma db push',
      }, { status: 503 })
    }

    const { id, permissions, ...rest } = data
    await customDb.update({ where: { id }, data: rest })

    if (permissions) {
      await permsDb.deleteMany({ where: { roleId: id } })
      if (permissions.length > 0) {
        await permsDb.createMany({
          data: permissions.map(k => ({ roleId: id, permissionKey: k })),
          skipDuplicates: true,
        })
      }
    }
    await audit(session.userId, 'UPDATE_ROLE', 'CustomRole', id, rest)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id مطلوب' }, { status: 400 })

    const customDb = (db as unknown as { customRole?: {
      delete: (args: unknown) => Promise<unknown>;
    } }).customRole
    if (!customDb) {
      return NextResponse.json({ error: 'جداول الأدوار غير موجودة' }, { status: 503 })
    }
    await customDb.delete({ where: { id } })
    await audit(session.userId, 'DELETE_ROLE', 'CustomRole', id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
