import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db/client'
import { rateLimit } from '@/lib/rateLimit'
import { hashPassword, validatePasswordStrength, getClientIp } from '@/lib/auth'

// Signup collects name + email + password. Accounts are created inactive
// (`isActive: false`) and cannot log in until an administrator activates
// them and assigns the appropriate role. Email is unique per the schema and
// stored lower-cased so login lookups are case-insensitive.
//
// Password strength uses the same policy as administrative password resets
// (validatePasswordStrength) and the hash uses 12 bcrypt rounds via the
// shared hashPassword helper — both must stay in lock-step with the rest of
// the auth surface.

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
  password: z.string().max(128),
})

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req)

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

    // Enforce the same password-strength rules as the rest of the platform.
    const strength = validatePasswordStrength(password)
    if (!strength.valid) {
      return NextResponse.json(
        { success: false, error: strength.message || 'كلمة المرور ضعيفة' },
        { status: 400 },
      )
    }

    // Reject if email already used. Returns a clear message; signup is
    // gated behind admin activation so this disclosure does not weaken the
    // login surface.
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

    const passwordHash = await hashPassword(password)

    try {
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
    } catch (e: unknown) {
      // P2002 = Prisma unique-constraint violation. Two concurrent signups
      // with the same email pass the existence check; the second one fails
      // here. Convert to the same 409 the caller would have received.
      if (
        typeof e === 'object' && e !== null &&
        'code' in e && (e as { code: unknown }).code === 'P2002'
      ) {
        return NextResponse.json(
          { success: false, error: 'هذا البريد مسجّل مسبقاً. تواصل مع الإدارة إذا كنت تعتقد أن هذا خطأ.' },
          { status: 409 },
        )
      }
      throw e
    }

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
