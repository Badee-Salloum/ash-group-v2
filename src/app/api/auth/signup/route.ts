import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '@/lib/db/client'
import { rateLimit } from '@/lib/rateLimit'

// Signup is intentionally minimal: only name + password. Email is auto-generated
// as a unique placeholder; admin updates it during activation. New accounts are
// created inactive (`isActive: false`) and cannot log in until an administrator
// activates them and assigns a real email/role.

const signupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'الاسم يجب أن يكون حرفين على الأقل')
    .max(80, 'الاسم طويل جداً'),
  password: z
    .string()
    .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
    .max(128),
})

function slugify(name: string): string {
  // Keep Arabic + ASCII letters/digits, replace whitespace with '-'
  const cleaned = name
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
  return cleaned || 'user'
}

function randomSuffix(len = 6): string {
  return Math.random().toString(36).slice(2, 2 + len)
}

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
    const { name, password } = signupSchema.parse(body)

    // Generate a unique placeholder email — admin replaces it on activation.
    const slug = slugify(name)
    let email = `${slug}-${randomSuffix()}@pending.ash-group.local`
    for (let i = 0; i < 5; i++) {
      const existing = await db.user.findUnique({ where: { email } })
      if (!existing) break
      email = `${slug}-${randomSuffix()}@pending.ash-group.local`
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
