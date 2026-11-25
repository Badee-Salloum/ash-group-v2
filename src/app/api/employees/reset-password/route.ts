import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

// POST /api/employees/reset-password
// Body: { id: string, password?: string }
//   - If `password` provided → use it (validated min 8 chars).
//   - Otherwise → auto-generate a temp password and return it (admin shares it).
// Permissions:
//   - ADMIN: can reset any account.
//   - MANAGER (مدير فرع): only EMPLOYEE-tier accounts.
//   - SUPERVISOR / others: forbidden.
const schema = z.object({
  id: z.string().min(1),
  password: z.string().min(8).optional(),
})

function generateTempPassword(): string {
  // 10-char password: mix of letters + digits, easy to read aloud.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const body = await req.json()
    const { id, password } = schema.parse(body)

    const target = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    })
    if (!target) return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 })
    if (!target.isActive) return NextResponse.json({ error: 'الحساب معطّل' }, { status: 400 })

    // MANAGER scope: only EMPLOYEE-tier accounts.
    if (session.role === UserRole.MANAGER && target.role !== UserRole.EMPLOYEE) {
      return NextResponse.json({ error: 'مدير الفرع يستطيع إعادة تعيين كلمات مرور الموظفين فقط' }, { status: 403 })
    }

    const tempPassword = password ?? generateTempPassword()
    const passwordHash = await bcrypt.hash(tempPassword, 10)

    await db.user.update({
      where: { id },
      data: {
        passwordHash,
        // Clear any lockout / failed-login state — fresh start.
        failedLogins: 0,
        lockedUntil: null,
      },
    })

    await audit(session.userId, 'RESET_PASSWORD', 'User', id, {
      target: target.email,
      generated: !password,
    })

    return NextResponse.json({
      success: true,
      data: {
        // Only return the temp password if WE generated it. If the admin
        // supplied their own, no need to echo it back.
        tempPassword: password ? null : tempPassword,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
