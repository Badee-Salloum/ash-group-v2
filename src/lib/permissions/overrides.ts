// Per-user permission override resolution — async layer on top of role defaults.

import { NextResponse } from 'next/server'
import type { SessionPayload } from '@/lib/auth'
import type { UserRole } from '@/lib/db/prisma-types'
import { db } from '@/lib/db/client'
import { hasPermission, permissionsForRole } from './check'
import { PERMISSION_CATEGORIES, type PermissionKey } from './keys'

const ALL_KEYS = PERMISSION_CATEGORIES.flatMap(c => c.keys.map(k => k.key))

export async function getUserOverrides(userId: string): Promise<Record<string, boolean>> {
  const rows = await db.permissionOverride.findMany({
    where: { userId },
    select: { permissionKey: true, isAllowed: true },
  })
  const map: Record<string, boolean> = {}
  for (const r of rows as Array<{ permissionKey: string; isAllowed: boolean }>) {
    map[r.permissionKey] = r.isAllowed
  }
  return map
}

export async function hasCapability(
  session: SessionPayload,
  key: PermissionKey,
): Promise<boolean> {
  const row = await db.permissionOverride.findUnique({
    where: { userId_permissionKey: { userId: session.userId, permissionKey: key } },
    select: { isAllowed: true },
  }).catch(() => null)
  if (row) return row.isAllowed
  return hasPermission(session.role, key)
}

export async function requireCapability(
  session: SessionPayload,
  key: PermissionKey,
): Promise<NextResponse | null> {
  const ok = await hasCapability(session, key)
  if (ok) return null
  return NextResponse.json(
    { error: 'لا تملك صلاحية للقيام بهذا الإجراء' },
    { status: 403 },
  )
}

export async function getEffectivePermissions(
  userId: string,
  role: UserRole,
): Promise<{ key: PermissionKey; source: 'role' | 'override-allow' | 'override-deny' }[]> {
  const overrides = await getUserOverrides(userId)
  const roleSet = new Set(permissionsForRole(role))
  const out: { key: PermissionKey; source: 'role' | 'override-allow' | 'override-deny' }[] = []
  for (const key of ALL_KEYS) {
    if (key in overrides) {
      out.push({ key, source: overrides[key] ? 'override-allow' : 'override-deny' })
    } else if (roleSet.has(key)) {
      out.push({ key, source: 'role' })
    }
  }
  return out
}
