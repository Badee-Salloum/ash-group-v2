'use client'
import { useRouter } from 'next/navigation'
import { UserRole } from '@/lib/db/prisma-types'
import { LogOut, Bell, Moon, Sun, Menu } from 'lucide-react'
import { useLanguage } from '@/lib/i18n/context'

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'مدير عام', SUPERVISOR: 'مشرف', ACCOUNT_MGR: 'مدير حساب',
  MANAGER: 'مدير فرع', EMPLOYEE: 'موظف',
}

interface TopbarProps {
  name: string
  role: UserRole
  onMenuClick?: () => void
}

export default function Topbar({ name, role, onMenuClick }: TopbarProps) {
  const router = useRouter()
  const { theme, toggleTheme } = useLanguage()

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2)

  return (
    <header className="h-[60px] bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border-b border-gray-200/30 dark:border-gray-700/30 flex items-center justify-between px-3 sm:px-4 md:px-6 shrink-0 relative z-10">
      {/* Left: hamburger on mobile */}
      <div className="flex items-center gap-2">
        <button
          onClick={onMenuClick}
          className="lg:hidden w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100/80 dark:hover:bg-gray-800 transition-all duration-300"
          aria-label="فتح القائمة"
        >
          <Menu size={20} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Dark mode toggle */}
        <button onClick={toggleTheme}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-all duration-300"
          title={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}>
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        <button className="hidden sm:flex w-9 h-9 rounded-xl items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-800 transition-all duration-300">
          <Bell size={17} />
        </button>

        <div className="hidden sm:block w-px h-7 bg-gray-200/50 dark:bg-gray-700/50" />

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[11px] font-bold shrink-0"
            style={{ background: 'linear-gradient(135deg, #0a2540 0%, #143d6b 100%)' }}>
            {initials}
          </div>
          {/* Hide name+role on very small screens */}
          <div className="hidden sm:block text-left">
            <p className="text-[13px] font-semibold text-gray-800 dark:text-gray-200 leading-tight truncate max-w-[140px]">{name}</p>
            <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-md mt-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              {ROLE_LABELS[role]}
            </span>
          </div>
        </div>

        <div className="hidden sm:block w-px h-7 bg-gray-200/50 dark:bg-gray-700/50" />

        <button onClick={handleLogout}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-300"
          title="تسجيل الخروج">
          <LogOut size={16} />
        </button>
      </div>
    </header>
  )
}
