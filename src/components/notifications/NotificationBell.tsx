'use client'
// Topbar bell with dropdown - polls only the unread count every 30s.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell, Gift, MinusCircle, Wallet, AlertTriangle, Banknote,
} from 'lucide-react'

interface NotificationItem {
  id: string
  type: string
  title: string
  body: string | null
  href: string | null
  readAt: string | null
  createdAt: string
}

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime()
  if (isNaN(d)) return ''
  const sec = Math.max(0, Math.floor((Date.now() - d) / 1000))
  if (sec < 60) return 'الآن'
  const min = Math.floor(sec / 60)
  if (min < 60) return `منذ ${min} دقيقة`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `منذ ${hr} ساعة`
  const day = Math.floor(hr / 24)
  return `منذ ${day} يوم`
}

function IconFor({ type }: { type: string }) {
  const cls = 'w-4 h-4'
  switch (type) {
    case 'BONUS_RECEIVED':
      return <Gift className={`${cls} text-emerald-500`} />
    case 'DEDUCTION_APPLIED':
      return <MinusCircle className={`${cls} text-rose-500`} />
    case 'PAYROLL_PAID':
      return <Wallet className={`${cls} text-blue-500`} />
    case 'COMPLAINT_ATTRIBUTED':
      return <AlertTriangle className={`${cls} text-amber-500`} />
    case 'ADVANCE_APPROVED':
    case 'ADVANCE_REJECTED':
      return <Banknote className={`${cls} text-indigo-500`} />
    default:
      return <Bell className={`${cls} text-gray-400`} />
  }
}

export default function NotificationBell() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Fetch state — we surface it as a ref so the setTimeout loop can read
  // the latest backoff/kill flags without re-scheduling every render.
  const backoffRef = useRef({ delayMs: 30_000, killed: false })

  const fetchUnreadCount = useCallback(async (): Promise<'ok' | 'unauthorized' | 'error'> => {
    try {
      const res = await fetch('/api/notifications/count', { cache: 'no-store' })
      if (res.status === 401) return 'unauthorized'
      if (!res.ok) return 'error'
      const json = await res.json()
      if (json?.success) {
        setUnreadCount(json.unreadCount || 0)
      }
      return 'ok'
    } catch {
      return 'error'
    }
  }, [])

  const fetchNotificationList = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/notifications?limit=10', { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json()
      if (json?.success) {
        setNotifications(json.data || [])
      }
    } catch {
      // Keep the most recently loaded list visible if the refresh fails.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Adaptive polling loop:
    //   * ok → reset delay to 30s
    //   * 401 → user is logged out; stop polling entirely to spare the DB
    //   * network/5xx → exponential backoff up to 5 min so a Neon suspend
    //     doesn't hammer the endpoint while it wakes.
    let timer: ReturnType<typeof setTimeout> | null = null
    async function tick() {
      if (backoffRef.current.killed) return
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(tick, 30_000)
        return
      }
      const result = await fetchUnreadCount()
      if (result === 'unauthorized') {
        backoffRef.current.killed = true
        return
      }
      if (result === 'ok') {
        backoffRef.current.delayMs = 30_000
      } else {
        backoffRef.current.delayMs = Math.min(backoffRef.current.delayMs * 2, 5 * 60_000)
      }
      timer = setTimeout(tick, backoffRef.current.delayMs)
    }
    tick()
    return () => {
      backoffRef.current.killed = true
      if (timer) clearTimeout(timer)
    }
  }, [fetchUnreadCount])

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void fetchUnreadCount()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [fetchUnreadCount])

  // close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [isOpen])

  async function markAllRead() {
    try {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllAsRead: true }),
      })
    } catch {
      // ignore
    }
  }

  async function markOneRead(id: string) {
    try {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      })
    } catch {
      // ignore
    }
  }

  function toggleOpen() {
    const next = !isOpen
    setIsOpen(next)
    if (next) {
      void fetchNotificationList()
    }
    if (next && unreadCount > 0) {
      // optimistic
      setUnreadCount(0)
      setNotifications(prev => prev.map(n => n.readAt ? n : { ...n, readAt: new Date().toISOString() }))
      void markAllRead()
    }
  }

  function handleItemClick(n: NotificationItem) {
    if (!n.readAt) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x))
      markOneRead(n.id)
    }
    if (n.href) {
      setIsOpen(false)
      router.push(n.href)
    }
  }

  const badge = unreadCount > 9 ? '9+' : String(unreadCount)
  const shown = notifications.slice(0, 10)
  const hasUnread = notifications.some(n => !n.readAt)

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={toggleOpen}
        className="hidden sm:flex w-9 h-9 rounded-xl items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-800 transition-all duration-300 relative"
        title="الإشعارات"
        aria-label="الإشعارات"
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {badge}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute mt-2 w-[340px] max-w-[90vw] rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl z-50 overflow-hidden"
          style={{ insetInlineStart: 0 }}
          dir="rtl"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">الإشعارات</h3>
            {hasUnread && (
              <button
                onClick={() => {
                  setNotifications(prev => prev.map(n => n.readAt ? n : { ...n, readAt: new Date().toISOString() }))
                  setUnreadCount(0)
                  markAllRead()
                }}
                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
              >
                مسح القراءة
              </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-gray-400">جارٍ التحميل…</div>
            ) : shown.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-gray-400">لا توجد إشعارات</div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {shown.map(n => {
                  const unread = !n.readAt
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => handleItemClick(n)}
                        className={[
                          'w-full text-right px-3 py-2.5 flex gap-2 items-start hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors',
                          unread ? 'bg-blue-50/40 dark:bg-blue-900/10 border-l-2 border-blue-500' : '',
                        ].join(' ')}
                      >
                        <div className="mt-0.5 shrink-0">
                          <IconFor type={n.type} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-medium text-gray-800 dark:text-gray-100 truncate">
                            {n.title}
                          </div>
                          {n.body && (
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">
                              {n.body}
                            </div>
                          )}
                          <div className="text-[10px] text-gray-400 mt-1">{timeAgo(n.createdAt)}</div>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={() => { setIsOpen(false); router.push('/my') }}
              className="w-full px-4 py-2.5 text-[12px] text-blue-600 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
            >
              عرض الكل
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
