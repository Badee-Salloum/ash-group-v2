import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '@/lib/db/client'
import { rateLimit } from '@/lib/rateLimit'

// Signup collects name + email + password. Accounts are created inactive
// (`isActive: false`) and cannot log in until an administrator activates
// them and assigns the appropriate role. Email is unique per the schema.

const signupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'الاسم يجب أن يكون حرفين على الأقل')
    .max(80, 'الاسم طويل جداً'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('البريد الإلكتروني غير صالح')
    .max(160),
  password: z
    .string()
    .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
    .max(128),
})

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') || req.ip || 'unknown'

    // Rate limit: 5 signup attempts per hour per IP
    const rl = rateLimit(`signup:${ip}`, { limit: 5, windowMs: 60 * 60_000 })
    if (!rl.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `محاولات كثيرة. حاول بعد ${Math.ceil(rl.resetInMs / 60_000)} دقيقة.`,
        },
        { status: 429 },
      )
    }

    const body = await req.json()
    const { name, email, password } = signupSchema.parse(body)

    // Reject if email already used. Returns a generic message either way to
    // avoid leaking which emails are registered.
    const existing = await db.user.findUnique({
      where: { email },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'هذا البريد مسجّل مسبقاً. تواصل مع الإدارة إذا كنت تعتقد أن هذا خطأ.' },
        { status: 409 },
      )
    }

    const passwordHash = await bcrypt.hash(password, 10)

    await db.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: 'EMPLOYEE',
        isActive: false,
      },
      select: { id: true },
    })

    return NextResponse.json({
      success: true,
      message: 'تم إنشاء الحساب بنجاح. حسابك بانتظار التفعيل من الإدارة.',
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message || 'بيانات غير صالحة' },
        { status: 400 },
      )
    }
    console.error('Signup error:', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { success: false, error: 'تعذّر إنشاء الحساب. حاول لاحقاً.' },
      { status: 500 },
    )
  }
}
