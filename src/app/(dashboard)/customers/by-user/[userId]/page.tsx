'use client'
import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function ByUserRedirectPage() {
  const params = useParams<{ userId: string }>()
  const router = useRouter()
  const userId = decodeURIComponent(params?.userId || '')

  useEffect(() => {
    if (!userId) return
    // Try to resolve the customer's display name via the API. If that fails
    // for any reason, fall back to the synthetic USER-<id> key which the
    // customer detail page also understands.
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/customers/by-user/${encodeURIComponent(userId)}`)
        const d = await res.json()
        if (cancelled) return
        const target = d?.success && d?.name ? d.name : `USER-${userId}`
        router.replace(`/customers/${encodeURIComponent(target)}`)
      } catch {
        if (cancelled) return
        router.replace(`/customers/${encodeURIComponent(`USER-${userId}`)}`)
      }
    })()
    return () => { cancelled = true }
  }, [userId, router])

  return (
    <div className="flex items-center justify-center p-20 text-gray-400 gap-2">
      <Loader2 size={20} className="animate-spin" />
      <span>جاري الوصول إلى حساب العميل...</span>
    </div>
  )
}
