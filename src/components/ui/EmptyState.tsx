import { Inbox, type LucideIcon } from 'lucide-react'

// Shared empty-state block — a muted icon, a title, an optional one-line hint,
// and an optional CTA. Replaces the bare "لا يوجد…" strings across pages.

export function EmptyState({
  icon: Icon = Inbox,
  title,
  hint,
  action,
  className = '',
}: {
  icon?: LucideIcon
  title: string
  hint?: string
  action?: { label: string; onClick: () => void }
  className?: string
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className}`}>
      <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
        <Icon size={26} className="text-gray-400 dark:text-gray-500" />
      </div>
      <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">{title}</p>
      {hint && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-xs">{hint}</p>
      )}
      {action && (
        <button onClick={action.onClick} className="btn-secondary btn-sm mt-4">
          {action.label}
        </button>
      )}
    </div>
  )
}

export default EmptyState
