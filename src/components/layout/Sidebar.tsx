'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { UserRole } from '@/lib/db/prisma-types'
import {
  LayoutDashboard, ArrowLeftRight, TrendingUp, Wallet,
  Users, Settings, Building2, Upload, History, X, Layers, UserCircle,
  Briefcase, Clock, Calendar, DollarSign, LayoutGrid, FileSpreadsheet, ChevronDown, Sparkles, UserPlus,
  MessageSquareWarning,
} from 'lucide-react'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  roles: UserRole[]
}

interface NavSection {
  title?: string
  items: NavItem[]
}

// Sidebar grouped by FUNCTION, not by project phase. Each section has a title
// (or is unlabelled for the very first "main" group).
const SECTIONS: NavSection[] = [
  {
    items: [
      { href: '/dashboard', label: 'لوحة التحكم', icon: <LayoutDashboard size={18} />, roles: [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.ACCOUNT_MGR] },
      { href: '/manager',   label: 'لوحة الفرع',  icon: <LayoutDashboard size={18} />, roles: [UserRole.MANAGER] },
      { href: '/my',        label: 'لوحتي',      icon: <LayoutGrid size={18} />,      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPERVISOR, UserRole.ACCOUNT_MGR, UserRole.EMPLOYEE] },
    ],
  },
  {
    title: 'العمليات المالية',
    items: [
      { href: '/reconciliation', label: 'المطابقة',  icon: <ArrowLeftRight size={18} />,         roles: [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.ACCOUNT_MGR] },
      { href: '/follow-ups',     label: 'المتابعات',  icon: <MessageSquareWarning size={18} />,   roles: [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.ACCOUNT_MGR] },
      { href: '/profits',        label: 'الأرباح',    icon: <TrendingUp size={18} />,             roles: [UserRole.ADMIN] },
      { href: '/expenses',       label: 'الصرفيات',   icon: <Wallet size={18} />,                 roles: [UserRole.ADMIN] },
    ],
  },
  {
    title: 'البيانات والاستيراد',
    items: [
      { href: '/upload',            label: 'رفع الملفات', icon: <Upload size={18} />,           roles: [UserRole.ADMIN, UserRole.SUPERVISOR] },
      { href: '/upload-history',    label: 'سجل الرفع',   icon: <History size={18} />,          roles: [UserRole.ADMIN, UserRole.SUPERVISOR] },
      { href: '/consolidation-log', label: 'سجل الدمج',   icon: <Layers size={18} />,           roles: [UserRole.ADMIN] },
    ],
  },
  {
    title: 'السجلات المرجعية',
    items: [
      { href: '/accounts',  label: 'الحسابات', icon: <Building2 size={18} />,    roles: [UserRole.ADMIN, UserRole.SUPERVISOR] },
      { href: '/customers', label: 'العملاء',   icon: <UserCircle size={18} />,   roles: [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.ACCOUNT_MGR] },
    ],
  },
  {
    title: 'الموارد البشرية',
    items: [
      { href: '/employees',  label: 'الموظفون',        icon: <Briefcase size={18} />,    roles: [UserRole.ADMIN, UserRole.MANAGER] },
      { href: '/shifts',     label: 'المناوبات',        icon: <Clock size={18} />,        roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPERVISOR, UserRole.EMPLOYEE] },
      { href: '/attendance', label: 'أوقات الدوام',    icon: <Clock size={18} />,        roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPERVISOR] },
      { href: '/schedule',   label: 'جدول المناوبات',  icon: <Calendar size={18} />,     roles: [UserRole.ADMIN, UserRole.MANAGER] },
      { href: '/payroll',    label: 'الرواتب',          icon: <DollarSign size={18} />,   roles: [UserRole.ADMIN, UserRole.MANAGER] },
      { href: '/bonuses',    label: 'المكافآت',         icon: <Sparkles size={18} />,     roles: [UserRole.ADMIN, UserRole.MANAGER] },
    ],
  },
  {
    title: 'النظام',
    items: [
      { href: '/pending-signups', label: 'طلبات التسجيل', icon: <UserPlus size={18} />, roles: [UserRole.ADMIN] },
      { href: '/users',    label: 'حسابات النظام', icon: <Users size={18} />,    roles: [UserRole.ADMIN] },
      { href: '/roles',    label: 'الأدوار والصلاحيات', icon: <Briefcase size={18} />, roles: [UserRole.ADMIN] },
      { href: '/settings', label: 'الإعدادات',     icon: <Settings size={18} />, roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPERVISOR, UserRole.ACCOUNT_MGR, UserRole.EMPLOYEE] },
    ],
  },
]

// flat list for legacy code (kept for any active-route highlight logic)
void FileSpreadsheet // reserve icon for future "تقارير" if needed

interface SidebarProps {
  role: UserRole
  open?: boolean
  onClose?: () => void
}

const STORAGE_KEY = 'sidebar:collapsed'

export default function Sidebar({ role, open = false, onClose }: SidebarProps) {
  const pathname = usePathname()
  // Filter each section's items by role; drop any section that has no items left.
  const visibleSections = SECTIONS
    .map(s => ({ ...s, items: s.items.filter(i => i.roles.includes(role)) }))
    .filter(s => s.items.length > 0)

  // Track collapsed sections by title. Untitled sections are always expanded.
  // Default: all titled sections start collapsed. Saved state from localStorage
  // overrides the default, and the active-section effect below auto-expands
  // whichever section contains the current route.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
      if (raw) {
        setCollapsed(new Set(JSON.parse(raw) as string[]))
      } else {
        // first visit → start with everything collapsed
        setCollapsed(new Set(SECTIONS.map(s => s.title).filter((t): t is string => !!t)))
      }
    } catch { /* ignore */ }
  }, [])
  // auto-expand the section that contains the current route
  useEffect(() => {
    const activeSection = visibleSections.find(s =>
      s.items.some(i => pathname === i.href || (i.href !== '/dashboard' && pathname.startsWith(i.href + '/')))
    )
    if (activeSection?.title && collapsed.has(activeSection.title)) {
      setCollapsed(prev => {
        const n = new Set(prev); n.delete(activeSection.title!); return n
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  function toggleSection(title: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next))) } catch { /* ignore */ }
      return next
    })
  }

  // Close drawer on route change (mobile)
  useEffect(() => {
    if (onClose) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return (
    <>
      {/* Backdrop on mobile when open */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed lg:relative z-50 lg:z-auto top-0 right-0 h-full w-[260px] shrink-0 overflow-hidden
          transition-transform duration-300 ease-out
          ${open ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`}
        style={{
          background: 'linear-gradient(180deg, #060e1a 0%, #0a2540 40%, #0d2f52 100%)',
        }}
      >
        {/* Background orbs */}
        <div className="absolute top-20 -right-20 w-60 h-60 bg-blue-500 rounded-full opacity-[0.04] blur-[60px]" />
        <div className="absolute bottom-40 -left-16 w-40 h-40 bg-cyan-400 rounded-full opacity-[0.05] blur-[50px]" />

        <div className="relative flex flex-col h-full">
          {/* Logo + close (mobile) */}
          <div className="px-5 py-5 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.jpg" alt="ASH GROUP" className="w-11 h-11 rounded-xl object-contain bg-white/95 p-0.5"
                style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }} />
              <div>
                <h1 className="text-[15px] font-extrabold text-white tracking-wide">ASH GROUP</h1>
                <p className="text-[9px] text-blue-400/40 font-semibold tracking-[0.2em] uppercase">Financial Services</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="lg:hidden w-8 h-8 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="إغلاق القائمة"
            >
              <X size={18} />
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-3 py-4 overflow-y-auto">
            {visibleSections.map((section, idx) => {
              const isCollapsed = !!section.title && collapsed.has(section.title)
              return (
                <div key={idx} className={idx === 0 ? '' : 'mt-4'}>
                  {section.title && (
                    <button
                      onClick={() => toggleSection(section.title!)}
                      className="w-full flex items-center justify-between px-4 mb-1.5 group"
                      aria-expanded={!isCollapsed}
                    >
                      <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-blue-300/30 group-hover:text-blue-300/60 transition-colors">
                        {section.title}
                      </span>
                      <ChevronDown
                        size={12}
                        className={`text-blue-300/30 group-hover:text-blue-300/60 transition-all duration-300 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                      />
                    </button>
                  )}
                  <div
                    className={`space-y-1 overflow-hidden transition-all duration-300 ${isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[800px] opacity-100'}`}
                  >
                    {section.items.map(item => {
                      const isActive = pathname === item.href ||
                        (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'))
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`relative flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-300
                            ${isActive
                              ? 'text-white'
                              : 'text-blue-200/40 hover:text-white/80 hover:bg-white/[0.04]'
                            }`}
                          style={isActive ? {
                            background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.04) 100%)',
                            boxShadow: '0 2px 10px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.06)',
                          } : {}}
                        >
                          <span className={`transition-all duration-300 ${isActive ? 'text-blue-300' : ''}`}>{item.icon}</span>
                          <span>{item.label}</span>
                          {isActive && (
                            <span className="absolute right-0 w-[3px] h-5 rounded-l-full"
                              style={{ background: 'linear-gradient(180deg, #38bdf8, #0ea5e9)' }} />
                          )}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </nav>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-white/[0.04]">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full animate-pulse"
                style={{ background: 'linear-gradient(135deg, #10b981, #34d399)', boxShadow: '0 0 8px rgba(16,185,129,0.5)' }} />
              <p className="text-[10px] text-white/20 font-medium">v1.0.0</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
