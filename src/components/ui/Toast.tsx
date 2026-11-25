'use client'
import {
  createContext, useContext, useState, useCallback, type ReactNode,
} from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

// Lightweight toast — a context + a bottom-centered stack. No dependency.
// Usage:  const toast = useToast();  toast('تم الحفظ')  /  toast('خطأ', 'error')

type ToastType = 'success' | 'error' | 'info'
interface ToastItem { id: number; message: string; type: ToastType }

const ToastCtx = createContext<(message: string, type?: ToastType) => void>(() => {})

export function useToast() {
  return useContext(ToastCtx)
}

let seq = 0

const STYLES: Record<ToastType, { cls: string; Icon: typeof CheckCircle2 }> = {
  success: { cls: 'bg-emerald-600 text-white', Icon: CheckCircle2 },
  error: { cls: 'bg-rose-600 text-white', Icon: AlertTriangle },
  info: { cls: 'bg-slate-800 text-white', Icon: Info },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setItems(s => s.filter(t => t.id !== id))
  }, [])

  const push = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++seq
    setItems(s => [...s, { id, message, type }])
    // Auto-dismiss after 3.5s — EXCEPT errors, which stay until the user
    // dismisses them explicitly. Silent errors are the #1 UX complaint in
    // the audit; timing them out just hides the problem.
    if (type !== 'error') {
      setTimeout(() => setItems(s => s.filter(t => t.id !== id)), 3500)
    }
  }, [])

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none px-4 w-full max-w-md">
        {items.map(t => {
          const { cls, Icon } = STYLES[t.type]
          return (
            <div
              key={t.id}
              role={t.type === 'error' ? 'alert' : 'status'}
              aria-live={t.type === 'error' ? 'assertive' : 'polite'}
              className={`pointer-events-auto flex items-center gap-2.5 ${cls} rounded-xl shadow-lg px-4 py-2.5 text-sm font-medium animate-slide-up max-w-full`}
            >
              <Icon size={16} className="shrink-0" />
              <span className="flex-1">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 opacity-70 hover:opacity-100"
                aria-label="إغلاق"
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastCtx.Provider>
  )
}
