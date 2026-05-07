import { describe, it, expect } from 'vitest'
import { hasPermission, requirePermission, permissionsForRole } from '@/lib/permissions/check'
import { PERMISSIONS } from '@/lib/permissions/keys'
import type { SessionPayload } from '@/lib/auth'

const session = (role: SessionPayload['role']): SessionPayload => ({
  userId: 'u1', email: 'x@y.z', name: 'X', role,
})

describe('hasPermission', () => {
  it('ADMIN has every permission', () => {
    for (const p of Object.values(PERMISSIONS)) {
      expect(hasPermission('ADMIN', p), `ADMIN should have ${p}`).toBe(true)
    }
  })

  it('EMPLOYEE has only SHIFTS_CHECKIN', () => {
    expect(hasPermission('EMPLOYEE', PERMISSIONS.SHIFTS_CHECKIN)).toBe(true)
    expect(hasPermission('EMPLOYEE', PERMISSIONS.USERS_MANAGE)).toBe(false)
    expect(hasPermission('EMPLOYEE', PERMISSIONS.PAYROLL_PAY)).toBe(false)
    expect(hasPermission('EMPLOYEE', PERMISSIONS.EMPLOYEES_DELETE)).toBe(false)
  })

  it('SUPERVISOR can upload reconciliation files (recently granted)', () => {
    expect(hasPermission('SUPERVISOR', PERMISSIONS.RECONCILIATION_UPLOAD)).toBe(true)
  })

  it('SUPERVISOR cannot manage payroll', () => {
    expect(hasPermission('SUPERVISOR', PERMISSIONS.PAYROLL_PAY)).toBe(false)
    expect(hasPermission('SUPERVISOR', PERMISSIONS.PAYROLL_ADJUST)).toBe(false)
  })

  it('MANAGER can run payroll but cannot manage system users/roles', () => {
    expect(hasPermission('MANAGER', PERMISSIONS.PAYROLL_PAY)).toBe(true)
    expect(hasPermission('MANAGER', PERMISSIONS.USERS_MANAGE)).toBe(false)
    expect(hasPermission('MANAGER', PERMISSIONS.ROLES_MANAGE)).toBe(false)
  })

  it('ACCOUNT_MGR can view + edit transactions but not delete employees', () => {
    expect(hasPermission('ACCOUNT_MGR', PERMISSIONS.TRANSACTIONS_VIEW)).toBe(true)
    expect(hasPermission('ACCOUNT_MGR', PERMISSIONS.TRANSACTIONS_EDIT)).toBe(true)
    expect(hasPermission('ACCOUNT_MGR', PERMISSIONS.EMPLOYEES_DELETE)).toBe(false)
  })
})

describe('requirePermission', () => {
  it('returns null when permission is granted', () => {
    expect(requirePermission(session('ADMIN'), PERMISSIONS.PAYROLL_PAY)).toBeNull()
  })

  it('returns 403 NextResponse when permission missing', () => {
    const res = requirePermission(session('EMPLOYEE'), PERMISSIONS.PAYROLL_PAY)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('the 403 body contains an Arabic message', async () => {
    const res = requirePermission(session('EMPLOYEE'), PERMISSIONS.USERS_MANAGE)
    expect(res).not.toBeNull()
    const body = await res!.json()
    expect(body.error).toContain('صلاحية')
  })
})

describe('permissionsForRole', () => {
  it('returns a non-empty array for every built-in role', () => {
    for (const r of ['ADMIN', 'MANAGER', 'SUPERVISOR', 'ACCOUNT_MGR', 'EMPLOYEE'] as const) {
      const perms = permissionsForRole(r)
      expect(perms.length, `role ${r} should have at least 1 permission`).toBeGreaterThan(0)
    }
  })

  it('ADMIN gets the full set', () => {
    const allPerms = Object.values(PERMISSIONS)
    expect(permissionsForRole('ADMIN').sort()).toEqual([...allPerms].sort())
  })

  it('returns a fresh array (caller can mutate without affecting defaults)', () => {
    const a = permissionsForRole('EMPLOYEE')
    const b = permissionsForRole('EMPLOYEE')
    expect(a).not.toBe(b)  // different references
    expect(a).toEqual(b)   // same content
  })
})
