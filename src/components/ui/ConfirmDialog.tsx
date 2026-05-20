'use client'
import {
  createContext, useContext, useState, useCallback, useRef, type ReactNode,
} from 'react'
import { AlertTriangle } from 'lucide-react'

// Promise-based confirm dialog — a styled replacement for window.confirm().
// Usage:  const confirm = useConfirm()
//         if (!await confirm('حذف هذا السجل؟')) return
// Multi-line messages render correctly (whitespace-pre-line), unlike the
// raw \n that the native confirm() showed literally.

interface ConfirmOptions {
  message: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}
type ConfirmFn = (opts: string | ConfirmOptions) => Promise<boolean>

const ConfirmCtx = createContext<ConfirmFn>(async () => false)

export function useConfirm() {
  return useContext(ConfirmCtx)
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((arg) => {
    const o = typeof arg === 'string' ? { message: arg } : arg
    setOpts(o)
    return new Promise<boolean>(resolve => { resolver.current = resolve })
  }, [])

  const close = useCallback((v: boolean) => {
    resolver.current?.(v)
    resolver.current = null
    setOpts(null)
  }, [])

  const danger = opts?.danger !== false

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {opts && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => close(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm animate-fade-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5 flex items-start gap-3">
              <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
                danger
                  ? 'bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400'
                  : 'bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400'
              }`}>
                <AlertTriangle size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-1">
                  {opts.title || 'تأكيد'}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">
                  {opts.message}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 dark:border-gray-800">
              <button onClick={() => close(false)} className="btn-secondary btn-sm">
                {opts.cancelLabel || 'إلغاء'}
              </button>
              <button
                onClick={() => close(true)}
                className={`btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`}
              >
                {opts.confirmLabel || 'تأكيد'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  )
}
