'use client'
import { useState, useEffect } from 'react'
import { UserRole } from '@/lib/db/prisma-types'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

export default function DashboardShell({
  role, name, children,
}: { role: UserRole; name: string; children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Desktop: whole-sidebar hide, persisted per browser (same pattern as theme).
  const [sidebarHidden, setSidebarHidden] = useState(false)

  useEffect(() => {
    setSidebarHidden(localStorage.getItem('sidebar:hidden') === '1')
  }, [])

  function toggleSidebarHidden() {
    setSidebarHidden(h => {
      const next = !h
      localStorage.setItem('sidebar:hidden', next ? '1' : '0')
      return next
    })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f0f2f5] dark:bg-[#0c1220]">
      <Sidebar role={role} open={sidebarOpen} hidden={sidebarHidden} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden relative min-w-0">
        {/* Subtle background orbs */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-500 rounded-full opacity-[0.02] blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-purple-500 rounded-full opacity-[0.02] blur-[100px] pointer-events-none" />
        <Topbar name={name} role={role} sidebarHidden={sidebarHidden}
          onMenuClick={() => setSidebarOpen(true)} onToggleSidebar={toggleSidebarHidden} />
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 relative">{children}</main>
      </div>
    </div>
  )
}
