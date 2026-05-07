import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'

const PUBLIC_PATHS = ['/login', '/signup', '/verify-2fa', '/api/auth/login', '/api/auth/signup', '/api/auth/2fa/verify']
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MINUTES || '30') * 60 * 1000

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next()
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) return NextResponse.next()

  const token = req.cookies.get('auth_token')?.value

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const session = await verifyToken(token)
  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'انتهت الجلسة' }, { status: 401 })
    }
    const response = NextResponse.redirect(new URL('/login', req.url))
    response.cookies.delete('auth_token')
    response.cookies.delete('last_activity')
    return response
  }

  // Check inactivity timeout (30 minutes)
  const lastActivity = req.cookies.get('last_activity')?.value
  if (lastActivity) {
    const elapsed = Date.now() - parseInt(lastActivity)
    if (elapsed > SESSION_TIMEOUT_MS) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'انتهت الجلسة بسبب عدم النشاط' }, { status: 401 })
      }
      const response = NextResponse.redirect(new URL('/login?reason=timeout', req.url))
      response.cookies.delete('auth_token')
      response.cookies.delete('last_activity')
      return response
    }
  }

  // Role-based landing rules. MANAGER (مدير فرع) is scoped to HR — no
  // financial dashboard, profits, reconciliation, etc.
  const isManager = session.role === 'MANAGER'
  const MANAGER_BLOCKED_PREFIXES = [
    '/dashboard', '/reconciliation', '/profits', '/expenses',
    '/upload', '/upload-history', '/consolidation-log',
    '/accounts', '/users', '/roles',
  ]
  if (isManager && !pathname.startsWith('/api/')) {
    if (MANAGER_BLOCKED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))) {
      return NextResponse.redirect(new URL('/manager', req.url))
    }
  }

  // Redirect root to landing page (dashboard for most, /employees for MANAGER).
  if (pathname === '/') {
    const landing = isManager ? '/manager' : '/dashboard'
    return NextResponse.redirect(new URL(landing, req.url))
  }

  // Update last activity timestamp
  const response = NextResponse.next()
  response.cookies.set('last_activity', String(Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60,
  })
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
