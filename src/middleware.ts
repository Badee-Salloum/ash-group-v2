import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth/token'

// Cron endpoints and admin backfill routes enforce their own auth (Bearer
// CRON_SECRET or ADMIN session inside the handler), so the cookie-based
// middleware check would otherwise block Vercel Cron and operator curl
// requests before they can present their Bearer.
const PUBLIC_PATHS = [
  '/login', '/signup', '/verify-2fa',
  '/api/auth/login', '/api/auth/signup', '/api/auth/2fa/verify',
  '/api/cron/',
  '/api/admin/backfill-withdrawal-matches',
  '/api/admin/diagnose-withdrawal-matches',
  '/api/admin/find-sc-tx',
  '/api/admin/bulk-classify-sc-only',
  '/api/admin/orphan-recipients',
  '/api/upload',
]
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MINUTES || '30') * 60 * 1000
const ACTIVITY_REFRESH_INTERVAL_MS = 5 * 60 * 1000

function shouldRefreshActivity(req: NextRequest, pathname: string) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true

  // Refresh on document navigations, but not on polling/data GETs. This keeps
  // read endpoints cacheable and prevents a background notification poll from
  // perpetually extending a session.
  if (pathname.startsWith('/api/')) return false
  const isDocumentNavigation = req.headers.get('accept')?.includes('text/html')
  const isClientNavigation = req.headers.has('RSC') && !req.headers.has('Next-Router-Prefetch')
  return Boolean(isDocumentNavigation || isClientNavigation)
}

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
  const isEmployee = session.role === 'EMPLOYEE'
  const isShiftManager = session.role === 'SHIFT_MANAGER'
  // /pending-signups is allowed for MANAGER — the API's /activate handler
  // limits their assignment to EMPLOYEE / SHIFT_MANAGER, and the client
  // dropdown pre-filters accordingly. Middleware blocking it here would just
  // hide the sidebar link's target and 302 them to /manager.
  const MANAGER_BLOCKED_PREFIXES = [
    '/dashboard', '/reconciliation', '/follow-ups', '/profits', '/expenses',
    '/upload', '/upload-history', '/consolidation-log',
    '/accounts', '/users', '/roles',
  ]
  // EMPLOYEE: scoped to personal pages (own dashboard, own shifts, settings).
  // Blocks financial admin pages AND HR admin pages.
  const EMPLOYEE_ALLOWED_PREFIXES = ['/my', '/shifts', '/settings', '/profile', '/api']
  // SHIFT_MANAGER: shift-manager landing + shifts + personal pages only.
  const SHIFT_MANAGER_ALLOWED_PREFIXES = ['/shift-manager', '/shifts', '/settings', '/profile', '/api']

  if (isManager && !pathname.startsWith('/api/')) {
    if (MANAGER_BLOCKED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))) {
      return NextResponse.redirect(new URL('/manager', req.url))
    }
  }

  if (isEmployee && !pathname.startsWith('/api/')) {
    const allowed = EMPLOYEE_ALLOWED_PREFIXES.some(
      p => pathname === p || pathname.startsWith(p + '/'),
    )
    if (!allowed) {
      return NextResponse.redirect(new URL('/my', req.url))
    }
  }

  if (isShiftManager && !pathname.startsWith('/api/')) {
    const allowed = SHIFT_MANAGER_ALLOWED_PREFIXES.some(
      p => pathname === p || pathname.startsWith(p + '/'),
    )
    if (!allowed) {
      return NextResponse.redirect(new URL('/shift-manager', req.url))
    }
  }

  // Redirect root to landing page per role.
  if (pathname === '/') {
    const landing = isManager
      ? '/manager'
      : isEmployee
        ? '/my'
        : isShiftManager
          ? '/shift-manager'
          : '/dashboard'
    return NextResponse.redirect(new URL(landing, req.url))
  }

  // Do not emit Set-Cookie for every API read. It defeats response caching and
  // turns passive polling into user activity. Refresh on user navigations or
  // mutations, and at most once per five minutes.
  const response = NextResponse.next()
  const lastActivityMs = lastActivity ? parseInt(lastActivity, 10) : 0
  if (
    shouldRefreshActivity(req, pathname) &&
    (!lastActivityMs || Date.now() - lastActivityMs >= ACTIVITY_REFRESH_INTERVAL_MS)
  ) {
    response.cookies.set('last_activity', String(Date.now()), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60,
    })
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
