'use client'
// Central badge — replaces the ~40 ad-hoc `bg-*-100 text-*-700 rounded-full`
// chip variants scattered across pages.

import type { ReactNode } from 'react'

export type BadgeTone = 'blue' | 'emerald' | 'amber' | 'rose' | 'gray' | 'purple' | 'teal'

const TONES: Record<BadgeTone, string> = {
  blue:    'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  amber:   'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  rose:    'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
  gray:    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  purple:  'bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300',
  teal:    'bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300',
}

interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
  icon?: ReactNode
  className?: string
}

export function Badge({ tone = 'gray', children, icon, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${TONES[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  )
}
