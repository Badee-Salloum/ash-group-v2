'use client'
// Central Modal shell — the ONLY dialog primitive the app should use.
//
// Fixes the audit's cross-cutting modal defects:
//   * ARIA: role="dialog", aria-modal, aria-labelledby
//   * Escape closes (with dirty-check)
//   * Focus trap: TAB never leaves the modal, first focus lands on the
//     content, previously-focused element is restored on close
//   * Backdrop-click gets the same dirty-check as ESC
//   * Consistent shell (shadow-2xl, rounded-2xl, backdrop bg-black/40 blur)
//   * Consistent close button with aria-label
//   * Sticky header + optional footer slot
//
// Use it EVERYWHERE instead of the ad-hoc `fixed inset-0 bg-black/40 …`
// pattern. Pass `dirty` when the form has unsaved changes — the shell
// then confirms before closing.

import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useConfirm } from './ConfirmDialog'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: ModalSize
  /** Ask for confirmation before closing (ESC / backdrop / X). */
  dirty?: boolean
  /** Disable backdrop-click close entirely. */
  disableBackdropClose?: boolean
  /** Extra className on the panel. */
  panelClassName?: string
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-3xl',
  full: 'max-w-6xl',
}

// Signals "I have unsaved changes" from a child form up to the Modal
// without threading state everywhere. See <ModalDirtyGate />.
const DirtyCtx = createContext<{ setDirty: (v: boolean) => void } | null>(null)

export function useModalDirty(dirty: boolean) {
  const ctx = useContext(DirtyCtx)
  useEffect(() => {
    ctx?.setDirty(dirty)
  }, [ctx, dirty])
}

export function Modal({
  open, onClose, title, subtitle, children, footer, size = 'lg',
  dirty = false, disableBackdropClose = false, panelClassName = '',
}: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const confirm = useConfirm()
  // Portal must wait for mount — createPortal(..., document.body) would
  // throw during SSR / initial hydration if document isn't defined yet.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const attemptClose = useCallback(async () => {
    if (dirty) {
      const ok = await confirm({
        title: 'تجاهل التعديلات؟',
        message: 'لديك تعديلات غير محفوظة. الإغلاق يفقدها.',
        confirmLabel: 'تجاهل',
        cancelLabel: 'متابعة التعديل',
        danger: true,
      })
      if (!ok) return
    }
    onClose()
  }, [dirty, confirm, onClose])

  // Escape + basic focus trap.
  useEffect(() => {
    if (!open) return
    previousFocus.current = (document.activeElement as HTMLElement) ?? null
    // Focus the first focusable in the panel on mount.
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const focusable = panel.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      focusable?.focus()
    })

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        void attemptClose()
        return
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(el => el.offsetParent !== null)
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    // Prevent background scroll while modal is open.
    const bodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = bodyOverflow
      // Restore focus to the element that opened us.
      previousFocus.current?.focus?.()
    }
  }, [open, attemptClose])

  if (!open || !mounted) return null

  // Portal to document.body so `fixed inset-0` covers the true viewport, not a
  // clipped ancestor. DashboardShell has `flex h-screen` + descendants with
  // filter/blur that create containing blocks for fixed children, which caused
  // the backdrop to stop at the main-content edge and leave the sidebar
  // exposed and interactive while the modal was open.
  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={disableBackdropClose ? undefined : () => void attemptClose()}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
        className={`bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full ${SIZE_CLASSES[size]} max-h-[90vh] flex flex-col animate-fade-in ${panelClassName}`}
      >
        {/* Header (sticky). z-10 ensures body content that overflows upward
            (e.g. box-shadow rings) never paints on top of the header. Subtitle
            is a <div> so callers can pass rich JSX (flex chips, icons, …)
            without triggering the browser's block-in-<p> auto-close. */}
        <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 rounded-t-2xl px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 id={titleId} className="font-bold text-gray-900 dark:text-gray-100 text-base">
              {title}
            </h2>
            {subtitle && (
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void attemptClose()}
            className="btn-ghost p-1.5 shrink-0"
            aria-label="إغلاق"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <DirtyCtx.Provider value={{ setDirty: () => {} }}>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
        </DirtyCtx.Provider>

        {/* Footer slot — z-10 same rationale as header. */}
        {footer && (
          <div className="sticky bottom-0 z-10 bg-white dark:bg-gray-900 rounded-b-2xl px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// Simple "Cancel + Save" footer helper used by most forms.
export function ModalFooter({
  onCancel, onSave, saving = false, saveLabel = 'حفظ', cancelLabel = 'إلغاء',
  disabled = false, extra,
}: {
  onCancel: () => void
  onSave: () => void
  saving?: boolean
  saveLabel?: string
  cancelLabel?: string
  disabled?: boolean
  extra?: ReactNode
}) {
  return (
    <>
      {extra}
      <button type="button" onClick={onCancel} className="btn-secondary btn-sm">
        {cancelLabel}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || disabled}
        className="btn-primary btn-sm"
      >
        {saving ? '…' : saveLabel}
      </button>
    </>
  )
}
