'use client'

import { useEffect } from 'react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Keep diagnostics free of financial payloads; Next/Vercel associates the
    // digest with the server-side error record.
    console.error('Dashboard route failed', { digest: error.digest })
  }, [error.digest])

  return (
    <div className="card border border-rose-200 bg-rose-50 p-6 text-center space-y-3" role="alert">
      <h2 className="text-lg font-bold text-rose-900">تعذر تحميل هذه الصفحة</h2>
      <p className="text-sm text-rose-700">تحقق من الاتصال ثم أعد المحاولة. لم تُفقد أي بيانات.</p>
      <button type="button" className="btn-secondary" onClick={reset}>إعادة المحاولة</button>
    </div>
  )
}
