// Server shell for /compensation. Reads the session role to gate the
// Rules tab; everything else (period, fetching, modals) lives inside
// the per-tab client components.

import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { UserRole } from '@/lib/db/prisma-types'
import { CompensationShell } from './_components/CompensationShell'

interface Props {
  searchParams: { tab?: string; filter?: string }
}

export default async function CompensationPage({ searchParams }: Props) {
  const session = await getSession()
  if (!session) redirect('/login')

  const allowed = ['overview', 'payroll', 'bonuses', 'rules'] as const
  type Tab = typeof allowed[number]
  const requested = (searchParams.tab as Tab) || 'overview'
  // ADMIN + MANAGER both have full rule authority per the user's
  // "صلاحية كاملة لمدير الفرع" direction.
  const canEditRules = session.role === UserRole.ADMIN || session.role === UserRole.MANAGER

  // Rules tab — silently drop non-eligible roles back to overview.
  let active: Tab = allowed.includes(requested) ? requested : 'overview'
  if (active === 'rules' && !canEditRules) active = 'overview'

  return (
    <CompensationShell
      activeTab={active}
      canEditRules={canEditRules}
      initialFilter={searchParams.filter ?? null}
    />
  )
}
