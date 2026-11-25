import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import DashboardShell from '@/components/layout/DashboardShell'
import { QueryScopeProvider } from '@/components/providers/QueryProvider'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <QueryScopeProvider scope={`${session.userId}:${session.role}`}>
      <DashboardShell role={session.role} name={session.name}>
        {children}
      </DashboardShell>
    </QueryScopeProvider>
  )
}
