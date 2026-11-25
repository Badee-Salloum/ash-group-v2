'use client'
// Tab-switcher shell for /compensation. Each tab is lazy-loaded the first
// time it's activated and kept mounted afterwards so cached state survives
// switches. Tab state is persisted to ?tab=… via router.push so browser
// Back/Forward navigates between tabs predictably.

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LayoutGrid, Wallet, Gift, Settings, Award } from 'lucide-react'
import { OverviewTab } from './OverviewTab'
import { PayrollTab } from './PayrollTab'
import { BonusesTab } from './BonusesTab'
import { BonusRulesTab } from './BonusRulesTab'
import { PageHeader } from '@/components/ui/PageHeader'

type Tab = 'overview' | 'payroll' | 'bonuses' | 'rules'

interface Props {
  activeTab: Tab
  canEditRules: boolean
  initialFilter: string | null
}

const TAB_META: Record<Tab, { label: string; icon: React.ReactNode; tone: string }> = {
  overview: { label: 'نظرة عامة', icon: <LayoutGrid size={14} />, tone: 'blue' },
  payroll:  { label: 'الرواتب',   icon: <Wallet size={14} />,    tone: 'emerald' },
  bonuses:  { label: 'المكافآت والخصومات', icon: <Gift size={14} />, tone: 'violet' },
  rules:    { label: 'القواعد',   icon: <Settings size={14} />,  tone: 'gray' },
}

export function CompensationShell({ activeTab, canEditRules, initialFilter }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(activeTab)
  // Track which tabs have been mounted so we can keep their state alive
  // (CSS hide/show) instead of unmounting on switch.
  const [mounted, setMounted] = useState<Record<Tab, boolean>>({
    overview: activeTab === 'overview',
    payroll:  activeTab === 'payroll',
    bonuses:  activeTab === 'bonuses',
    rules:    activeTab === 'rules',
  })
  // Filter chip passed to PayrollTab on first activation (e.g. ?filter=unpaid).
  const [payrollFilter, setPayrollFilter] = useState<string | null>(
    activeTab === 'payroll' ? initialFilter : null,
  )

  const switchTab = useCallback((next: Tab, filter?: string) => {
    if (next === 'rules' && !canEditRules) return
    setTab(next)
    setMounted(prev => prev[next] ? prev : { ...prev, [next]: true })
    if (next === 'payroll' && filter) setPayrollFilter(filter)
    const params = new URLSearchParams()
    params.set('tab', next)
    if (next === 'payroll' && filter) params.set('filter', filter)
    router.push(`/compensation?${params.toString()}`)
  }, [router, canEditRules])

  const visibleTabs: Tab[] = canEditRules
    ? ['overview', 'payroll', 'bonuses', 'rules']
    : ['overview', 'payroll', 'bonuses']

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        icon={<Award size={20} />}
        title="التعويضات والأداء"
        subtitle="إدارة الرواتب والمكافآت ومؤشّرات الأداء."
      />

      {/* Tab switcher */}
      <div className="flex items-center gap-1.5 flex-wrap border-b border-gray-200 pb-0">
        {visibleTabs.map(t => {
          const meta = TAB_META[t]
          const isActive = t === tab
          const isRules = t === 'rules'
          return (
            <button
              key={t}
              onClick={() => switchTab(t)}
              className={[
                'inline-flex items-center gap-1.5 px-3.5 py-2 text-sm rounded-t-lg border-b-2 transition-colors',
                isActive
                  ? 'border-blue-600 text-blue-700 font-semibold bg-blue-50/40'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50',
                isRules ? 'ms-auto text-xs opacity-80' : '',
              ].join(' ')}
            >
              {meta.icon}
              {meta.label}
            </button>
          )
        })}
      </div>

      {/* Tab content — keep mounted to preserve state on switch */}
      <div>
        {mounted.overview && (
          <div className={tab === 'overview' ? '' : 'hidden'}>
            <OverviewTab onSwitchTab={switchTab} />
          </div>
        )}
        {mounted.payroll && (
          <div className={tab === 'payroll' ? '' : 'hidden'}>
            <PayrollTab initialFilter={payrollFilter} />
          </div>
        )}
        {mounted.bonuses && (
          <div className={tab === 'bonuses' ? '' : 'hidden'}>
            <BonusesTab />
          </div>
        )}
        {mounted.rules && canEditRules && (
          <div className={tab === 'rules' ? '' : 'hidden'}>
            <BonusRulesTab />
          </div>
        )}
      </div>
    </div>
  )
}
