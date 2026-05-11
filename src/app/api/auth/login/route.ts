import { NextRequest, NextResponse } from 'next/server'
import { loginUser, getClientIp } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = loginSchema.parse(body)
    const ip = getClientIp(req)

    // Rate limit: 10 attempts per 5 min per IP+email pair (defence-in-depth
    // alongside the per-account lockout in loginUser).
    const rl = rateLimit(`login:${ip}:${email}`, { limit: 10, windowMs: 5 * 60_000 })
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: `محاولات كثيرة. حاول بعد ${Math.ceil(rl.resetInMs / 1000)} ثانية.` },
        { status: 429 },
      )
    }

    const result = await loginUser(email, password, ip)

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 401 })
    }

    if (result.requires2FA) {
      // Set temporary 2FA pending cookie (5 min expiry)
      const response = NextResponse.json({ success: true, requires2FA: true })
      response.cookies.set('pending_2fa', result.userId!, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 5 * 60,
        path: '/',
      })
      return response
    }

    const response = NextResponse.json({
      success: true,
      user: { id: result.user!.id, name: result.user!.name, email: result.user!.email, role: result.user!.role },
    })

    response.cookies.set('auth_token', result.token!, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60,
      path: '/',
    })

    // Set last_activity for inactivity timeout
    response.cookies.set('last_activity', String(Date.now()), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60,
    })

    return response
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'بيانات غير صالحة' }, { status: 400 })
    }
    console.error('Login error:', error)
    console.error('Login error details:', error instanceof Error ? error.message : error)
    return NextResponse.json({ success: false, error: 'خطأ في الخادم' }, { status: 500 })
  }
}
