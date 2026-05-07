'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shield, Loader2 } from 'lucide-react'

export default function Verify2FAPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (code.length !== 6) return
    setLoading(true); setError('')

    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: code }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'خطأ في التحقق')
      router.push('/dashboard')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-6">
            <div className="mx-auto w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <Shield className="text-blue-600" size={28} />
            </div>
            <h1 className="text-xl font-bold text-gray-900">المصادقة الثنائية</h1>
            <p className="text-sm text-gray-500 mt-1">أدخل رمز التحقق من تطبيق المصادقة</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="input text-center text-2xl tracking-[0.5em] font-mono"
              placeholder="000000"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
            />

            {error && (
              <p className="text-red-600 text-sm text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="btn-primary w-full py-3"
            >
              {loading ? <Loader2 size={18} className="animate-spin mx-auto" /> : 'تحقق'}
            </button>
          </form>

          <p className="text-xs text-gray-400 text-center mt-4">
            الرمز صالح لمدة 30 ثانية
          </p>
        </div>
      </div>
    </div>
  )
}
