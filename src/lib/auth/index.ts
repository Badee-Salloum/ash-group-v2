import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

// Require JWT_SECRET in all non-test environments — never silently fall back
// to a hardcoded dev secret in production.
const RAW_JWT_SECRET = process.env.JWT_SECRET
if (!RAW_JWT_SECRET || RAW_JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required (min 32 chars)')
  }
  // eslint-disable-next-line no-console
  console.warn('[auth] JWT_SECRET missing or too short — using insecure dev fallback')
}
const JWT_SECRET = new TextEncoder().encode(
  RAW_JWT_SECRET && RAW_JWT_SECRET.length >= 32
    ? RAW_JWT_SECRET
    : 'dev_secret_change_in_production_min_32_chars'
)
const JWT_EXPIRY = (process.env.JWT_EXPIRY || '8h').trim()
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT_MINUTES || '30') * 60 * 1000
const MAX_FAILED = parseInt(process.env.MAX_FAILED_LOGINS || '5')
const LOCKOUT_MS = parseInt(process.env.LOCKOUT_MINUTES || '30') * 60 * 1000

export interface SessionPayload {
  userId: string
  email: string
  name: string
  role: UserRole
  iat?: number
  exp?: number
}

// ─── Token ──────────────────────────────────────────────────────────────────

export async function signToken(payload: Omit<SessionPayload, 'iat' | 'exp'>) {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET)
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}

// ─── Session ─────────────────────────────────────────────────────────────────

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = cookies()
  const token = cookieStore.get('auth_token')?.value
  if (!token) return null
  return verifyToken(token)
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession()
  if (!session) throw new Error('UNAUTHORIZED')
  return session
}

export function requireRole(session: SessionPayload, roles: UserRole[]) {
  if (!roles.includes(session.role)) throw new Error('FORBIDDEN')
}

// ─── Password ────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function validatePasswordStrength(password: string): { valid: boolean; message?: string } {
  if (password.length < 8) return { valid: false, message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' }
  if (!/[A-Z]/.test(password)) return { valid: false, message: 'يجب أن تحتوي على حرف كبير' }
  if (!/[a-z]/.test(password)) return { valid: false, message: 'يجب أن تحتوي على حرف صغير' }
  if (!/[0-9]/.test(password)) return { valid: false, message: 'يجب أن تحتوي على رقم' }
  return { valid: true }
}

// ─── Login ───────────────────────────────────────────────────────────────────

// Extract the real client IP from x-forwarded-for. Vercel/most proxies prepend
// the originating client and append intermediate hops, so the first entry is
// the one we want for rate-limit and audit purposes.
export function getClientIp(req: { headers: { get: (k: string) => string | null } }): string {
  const xff = req.headers.get('x-forwarded-for') || ''
  const first = xff.split(',')[0]?.trim()
  return first || 'unknown'
}

export async function loginUser(email: string, password: string, ip?: string) {
  // Normalize email — accounts are stored lower-cased, so login lookups must
  // match regardless of what the user typed.
  const normalizedEmail = email.trim().toLowerCase()
  const user = await db.user.findUnique({ where: { email: normalizedEmail } })

  if (!user || !user.isActive) {
    return { success: false, error: 'بيانات الدخول غير صحيحة' }
  }

  // Check lockout
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const remainingMs = user.lockedUntil.getTime() - Date.now()
    const remainingMin = Math.ceil(remainingMs / 60000)
    return { success: false, error: `الحساب مقفل. حاول بعد ${remainingMin} دقيقة` }
  }

  const passwordValid = await verifyPassword(password, user.passwordHash)

  if (!passwordValid) {
    const newFailedCount = user.failedLogins + 1
    const updates: Record<string, unknown> = { failedLogins: newFailedCount }

    if (newFailedCount >= MAX_FAILED) {
      updates.lockedUntil = new Date(Date.now() + LOCKOUT_MS)
      updates.failedLogins = 0
    }

    await db.user.update({ where: { id: user.id }, data: updates })
    await db.auditLog.create({
      data: { userId: user.id, action: 'LOGIN_FAILED', details: { ip }, ipAddress: ip },
    })

    return { success: false, error: 'بيانات الدخول غير صحيحة' }
  }

  // Reset failed logins
  await db.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  })

  await db.auditLog.create({
    data: { userId: user.id, action: 'LOGIN_SUCCESS', ipAddress: ip },
  })

  // If 2FA enabled, return partial session
  if (user.twoFactorEnabled) {
    return { success: true, requires2FA: true, userId: user.id }
  }

  const token = await signToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  })

  return { success: true, requires2FA: false, token, user }
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export async function audit(
  userId: string | null,
  action: string,
  entity?: string,
  entityId?: string,
  details?: Record<string, unknown>,
  ip?: string
) {
  await db.auditLog.create({
    data: { userId, action, entity, entityId, details, ipAddress: ip },
  })
}
