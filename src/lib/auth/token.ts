import { SignJWT, jwtVerify } from 'jose'

/**
 * Edge-safe JWT primitives. Keep this module free of Prisma, bcrypt, and
 * next/headers so middleware can verify a session without bundling
 * server-only authentication dependencies.
 */
export type SessionRole =
  | 'ADMIN'
  | 'ACCOUNTANT'
  | 'SUPERVISOR'
  | 'ACCOUNT_MGR'
  | 'MANAGER'
  | 'EMPLOYEE'
  | 'SHIFT_MANAGER'

export interface SessionPayload {
  userId: string
  email: string
  name: string
  role: SessionRole
  iat?: number
  exp?: number
}

const rawJwtSecret = process.env.JWT_SECRET
if (!rawJwtSecret || rawJwtSecret.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required (min 32 chars)')
  }
  // eslint-disable-next-line no-console
  console.warn('[auth] JWT_SECRET missing or too short - using insecure dev fallback')
}

const jwtSecret = new TextEncoder().encode(
  rawJwtSecret && rawJwtSecret.length >= 32
    ? rawJwtSecret
    : 'dev_secret_change_in_production_min_32_chars',
)
const jwtExpiry = (process.env.JWT_EXPIRY || '8h').trim()

export async function signToken(payload: Omit<SessionPayload, 'iat' | 'exp'>) {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(jwtExpiry)
    .sign(jwtSecret)
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret)
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}
