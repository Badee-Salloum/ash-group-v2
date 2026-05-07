// Permission check helpers — the single source of truth.
//
// Resolution order:
//   1. If user has any custom roles assigned (Role table), union their grants
//   2. Else, fall back to ROLE_DEFAULT_PERMISSIONS for the built-in enum role
//   3. Per-user permission JSON overrides may add or revoke (future)
//
// For now, the new Role/RolePermission tables don't exist in the DB yet
// (awaiting `prisma db push`). This implementation transparently falls back to
// the legacy enum role + role defaults — so callers can already use
// `requirePermission()` instead of `requireRole()`.

import { NextResponse } from 'next/server'
import type { SessionPayload } from '@/lib/auth'
import type { UserRole } from '@/lib/db/prisma-types'
import { ROLE_DEFAULT_PERMISSIONS } from './roleDefaults'
import type { PermissionKey } from './keys'

export function hasPermission(role: UserRole, key: PermissionKey): boolean {
  const set = ROLE_DEFAULT_PERMISSIONS[role] || []
  return set.includes(key)
}

/**
 * Throws a NextResponse if the session lacks the permission. Intended to be
 * called inside an API route's try/catch, where the throw bubbles to the
 * top-level handler.
 *
 * Usage:
 *   const session = await getSession()
 *   if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
 *   const denial = requirePermission(session, PERMISSIONS.PAYROLL_PAY)
 *   if (denial) return denial
 */
export function requirePermission(
  session: SessionPayload,
  key: PermissionKey,
): NextResponse | null {
  if (hasPermission(session.role, key)) return null
  return NextResponse.json(
    { error: 'لا تملك صلاحية للقيام بهذا الإجراء' },
    { status: 403 },
  )
}

export function permissionsForRole(role: UserRole): PermissionKey[] {
  return [...(ROLE_DEFAULT_PERMISSIONS[role] || [])]
}
