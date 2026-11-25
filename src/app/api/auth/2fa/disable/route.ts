import { NextRequest, NextResponse } from 'next/server'
import { getSession, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { authenticator } from 'otplib'
import { z } from 'zod'

const schema = z.object({
  token: z.string().length(6),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const body = await req.json()
    const { token } = schema.parse(body)

    const user = await db.user.findUnique({ where: { id: session.userId } })
    if (!user?.twoFactorSecret) {
      return NextResponse.json({ error: 'المصادقة الثنائية غير مفعلة' }, { status: 400 })
    }

    const valid = authenticator.check(token, user.twoFactorSecret)
    if (!valid) {
      return NextResponse.json({ success: false, error: 'رمز التحقق غير صحيح' }, { status: 400 })
    }

    await db.user.update({
      where: { id: session.userId },
      data: { twoFactorSecret: null, twoFactorEnabled: false },
    })

    await audit(session.userId, '2FA_DISABLED', 'User', session.userId)

    return NextResponse.json({ success: true, message: 'تم إلغاء المصادقة الثنائية' })
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: 'رمز التحقق يجب أن يكون 6 أرقام' }, { status: 400 })
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
