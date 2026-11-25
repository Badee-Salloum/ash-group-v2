import { db } from '@/lib/db/client'

// Employee-code numbering scheme.
//
// Each role has its own 3-letter prefix so the code at a glance tells you
// what kind of account it is. Counters are independent per prefix — adding
// an EMPLOYEE bumps EMP, adding a MANAGER bumps MGR.
//
//   ADMIN         → ADM-XXXX  (مدير عام)
//   MANAGER       → MGR-XXXX  (مدير فرع)
//   SHIFT_MANAGER → SHM-XXXX  (مدير نوبة)
//   SUPERVISOR    → SUP-XXXX  (مشرف)
//   ACCOUNT_MGR   → ACM-XXXX  (مدير حساب)
//   ACCOUNTANT    → ACT-XXXX  (محاسب)
//   EMPLOYEE      → EMP-XXXX  (موظف)
//
// Default fallback (unknown role) → STF-XXXX. Existing codes that don't
// match a role's prefix are NOT overwritten — backfill only fills missing
// codes so we never break a printed/known identifier.

export const ROLE_CODE_PREFIX: Record<string, string> = {
  ADMIN:         'ADM',
  MANAGER:       'MGR',
  SHIFT_MANAGER: 'SHM',
  SUPERVISOR:    'SUP',
  ACCOUNT_MGR:   'ACM',
  ACCOUNTANT:    'ACT',
  EMPLOYEE:      'EMP',
}

const FALLBACK_PREFIX = 'STF'

export function prefixForRole(role: string): string {
  return ROLE_CODE_PREFIX[role] || FALLBACK_PREFIX
}

// Next code for the given role. Walks the existing codes with that prefix
// numerically, returns prefix-padded(largest + 1).
export async function nextCodeForRole(role: string): Promise<string> {
  const prefix = prefixForRole(role)
  return nextCodeForPrefix(prefix)
}

export async function nextCodeForPrefix(prefix: string): Promise<string> {
  const last = await db.user.findFirst({
    where: { employeeCode: { startsWith: `${prefix}-` } },
    orderBy: { employeeCode: 'desc' },
    select: { employeeCode: true },
  })
  const lastNum = last?.employeeCode
    ? parseInt(last.employeeCode.replace(`${prefix}-`, ''), 10)
    : 0
  const next = Number.isFinite(lastNum) ? lastNum + 1 : 1
  return `${prefix}-${String(next).padStart(4, '0')}`
}

// Used by the backfill endpoint. Returns true if `code` has the right
// prefix for `role` (so we leave it alone). Codes that are non-null but
// have a different prefix are intentionally KEPT — losing a printed
// identifier is worse than tolerating a stale prefix.
export function codeMatchesRole(code: string | null | undefined, role: string): boolean {
  if (!code) return false
  return code.startsWith(`${prefixForRole(role)}-`)
}
