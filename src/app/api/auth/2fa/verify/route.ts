import { NextRequest, NextResponse } from 'next/server'
import { getSession, signToken, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { rateLimit } from '@/lib/rateLimit'
import { authenticator } from 'otplib'
import { z } from 'zod'

const setupSchema = z.object({
  secret: z.string(),
  token: z.string().length(6),
})

const loginSchema = z.object({
  token: z.string().length(6),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Case 1: Verifying during 2FA setup (user already logged in)
    const session = await getSession()
    if (session) {
      const { secret, token } = setupSchema.parse(body)
      const valid = authenticator.check(token, secret)
      if (!valid) {
        return NextResponse.json({ success: false, error: 'رمز التحقق غير صحيح' }, { status: 400 })
      }

      await db.user.update({
        where: { id: session.userId },
        data: { twoFactorSecret: secret, twoFactorEnabled: true },
      })

      await audit(session.userId, '2FA_ENABLED', 'User', session.userId)

      return NextResponse.json({ success: true, message: 'تم تفعيل المصادقة الثنائية' })
    }

    // Case 2: Verifying during login (pending_2fa cookie)
    const pending2fa = req.cookies.get('pending_2fa')?.value
    if (!pending2fa) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    }

    // Rate limit TOTP brute-force: 8 attempts per minute per pending session
    const rl2 = rateLimit(`2fa:${pending2fa}`, { limit: 8, windowMs: 60_000 })
    if (!rl2.ok) {
      return NextResponse.json(
        { success: false, error: `محاولات كثيرة. حاول بعد ${Math.ceil(rl2.resetInMs / 1000)} ثانية.` },
        { status: 429 },
      )
    }

    const { token } = loginSchema.parse(body)

    const user = await db.user.findUnique({ where: { id: pending2fa } })
    if (!user || !user.twoFactorSecret) {
      return NextResponse.json({ error: 'خطأ في المصادقة' }, { status: 400 })
    }

    const valid = authenticator.check(token, user.twoFactorSecret)
    if (!valid) {
      return NextResponse.json({ success: false, error: 'رمز التحقق غير صحيح' }, { status: 400 })
    }

    // Issue JWT token
    const jwtToken = await signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    })

    await audit(user.id, '2FA_LOGIN_SUCCESS', 'User', user.id)

    const response = NextResponse.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    })

    response.cookies.set('auth_token', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60,
      path: '/',
    })
    response.cookies.set('last_activity', String(Date.now()), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60,
    })
    response.cookies.delete('pending_2fa')

    return response
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: 'رمز التحقق يجب أن يكون 6 أرقام' }, { status: 400 })
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
