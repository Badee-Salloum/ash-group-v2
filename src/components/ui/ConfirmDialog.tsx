'use client'
import {
  createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode,
} from 'react'
import { AlertTriangle } from 'lucide-react'

// Promise-based confirm + prompt dialogs — styled replacements for
// window.confirm() / window.prompt(). Multi-line messages render
// correctly (whitespace-pre-line).
//
// Usage:
//   const confirm = useConfirm()
//   if (!await confirm('حذف هذا السجل؟')) return
//
//   const prompt = usePrompt()
//   const name = await prompt({ title: 'اسم المجموعة', label: 'الاسم' })
//   if (!name) return

interface ConfirmOptions {
  message: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  // NOTE: previous default was `danger !== false` — that made every string
  // input render red. Now we default to false so informational confirms
  // look neutral; pass `danger: true` for destructive actions.
  danger?: boolean
}
type ConfirmFn = (opts: string | ConfirmOptions) => Promise<boolean>

const ConfirmCtx = createContext<ConfirmFn>(async () => false)

export function useConfirm() {
  return useContext(ConfirmCtx)
}

interface PromptOptions {
  title?: string
  label?: string
  message?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
  multiline?: boolean
}
type PromptFn = (opts: PromptOptions) => Promise<string | null>

const PromptCtx = createContext<PromptFn>(async () => null)

export function usePrompt() {
  return useContext(PromptCtx)
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const [promptOpts, setPromptOpts] = useState<PromptOptions | null>(null)
  const [promptValue, setPromptValue] = useState('')
  const promptResolver = useRef<((v: string | null) => void) | null>(null)

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

  const prompt = useCallback<PromptFn>((o) => {
    setPromptOpts(o)
    setPromptValue(o.defaultValue ?? '')
    return new Promise<string | null>(resolve => { promptResolver.current = resolve })
  }, [])

  const closePrompt = useCallback((v: string | null) => {
    promptResolver.current?.(v)
    promptResolver.current = null
    setPromptOpts(null)
    setPromptValue('')
  }, [])

  // Global Escape handling for both dialogs (a11y).
  useEffect(() => {
    if (!opts && !promptOpts) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (promptOpts) closePrompt(null)
        else if (opts) close(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [opts, promptOpts, close, closePrompt])

  const danger = opts?.danger === true

  return (
    <ConfirmCtx.Provider value={confirm}>
      <PromptCtx.Provider value={prompt}>
      {children}
      {opts && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => close(false)}
          role="presentation"
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm animate-fade-in"
            onClick={e => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
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
                autoFocus
              >
                {opts.confirmLabel || 'تأكيد'}
              </button>
            </div>
          </div>
        </div>
      )}
      {promptOpts && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => closePrompt(null)}
          role="presentation"
        >
          <form
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm animate-fade-in"
            onClick={e => e.stopPropagation()}
            onSubmit={e => { e.preventDefault(); closePrompt(promptValue.trim() || null) }}
            role="dialog"
            aria-modal="true"
          >
            <div className="p-5 space-y-3">
              <h3 className="font-bold text-gray-900 dark:text-gray-100">
                {promptOpts.title || 'إدخال'}
              </h3>
              {promptOpts.message && (
                <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">
                  {promptOpts.message}
                </p>
              )}
              {promptOpts.label && (
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {promptOpts.label}
                </label>
              )}
              {promptOpts.multiline ? (
                <textarea
                  className="input min-h-[80px]"
                  value={promptValue}
                  onChange={e => setPromptValue(e.target.value)}
                  placeholder={promptOpts.placeholder}
                  autoFocus
                />
              ) : (
                <input
                  className="input"
                  value={promptValue}
                  onChange={e => setPromptValue(e.target.value)}
                  placeholder={promptOpts.placeholder}
                  autoFocus
                />
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 dark:border-gray-800">
              <button type="button" onClick={() => closePrompt(null)} className="btn-secondary btn-sm">
                {promptOpts.cancelLabel || 'إلغاء'}
              </button>
              <button type="submit" className="btn-primary btn-sm">
                {promptOpts.confirmLabel || 'تأكيد'}
              </button>
            </div>
          </form>
        </div>
      )}
      </PromptCtx.Provider>
    </ConfirmCtx.Provider>
  )
}
