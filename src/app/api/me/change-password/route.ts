import { NextRequest, NextResponse } from 'next/server'
import { getSession, verifyPassword, hashPassword, validatePasswordStrength, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { z } from 'zod'

// POST /api/me/change-password
// Body: { currentPassword, newPassword }
// Self-service password change for any logged-in user.
const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const body = await req.json()
    const { currentPassword, newPassword } = schema.parse(body)

    if (currentPassword === newPassword) {
      return NextResponse.json({ error: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية' }, { status: 400 })
    }

    const strength = validatePasswordStrength(newPassword)
    if (!strength.valid) return NextResponse.json({ error: strength.message }, { status: 400 })

    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, passwordHash: true, isActive: true },
    })
    if (!user || !user.isActive) {
      return NextResponse.json({ error: 'الحساب غير موجود أو معطّل' }, { status: 404 })
    }

    const ok = await verifyPassword(currentPassword, user.passwordHash)
    if (!ok) return NextResponse.json({ error: 'كلمة المرور الحالية غير صحيحة' }, { status: 400 })

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword), failedLogins: 0, lockedUntil: null },
    })

    await audit(session.userId, 'CHANGE_OWN_PASSWORD', 'User', session.userId, {})
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
