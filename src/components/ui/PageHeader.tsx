'use client'
// Single source of truth for landing / interior page headers. Replaces
// the five different h1 styles the audit found across dashboard, manager,
// my, shift-manager, and manager/errors.

import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, icon, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`flex items-start justify-between flex-wrap gap-3 ${className}`}>
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300 shrink-0 flex items-center justify-center">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-wrap ms-auto">{actions}</div>
      )}
    </div>
  )
}
