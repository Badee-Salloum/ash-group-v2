'use client'
// Unified loading + empty states — pages currently use 4 different patterns.

import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

interface LoadingProps {
  label?: string
  size?: number
  className?: string
}

export function Loading({ label = 'جاري التحميل...', size = 24, className = '' }: LoadingProps) {
  return (
    <div className={`p-12 text-center text-gray-400 dark:text-gray-500 ${className}`} role="status" aria-live="polite">
      <Loader2 size={size} className="mx-auto animate-spin mb-2" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

interface EmptyProps {
  icon?: ReactNode
  message: string
  hint?: string
  action?: ReactNode
  className?: string
}

export function EmptyPanel({ icon, message, hint, action, className = '' }: EmptyProps) {
  return (
    <div className={`p-12 text-center ${className}`}>
      {icon && <div className="mx-auto mb-3 text-gray-300 dark:text-gray-600 flex justify-center">{icon}</div>}
      <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">{message}</p>
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
