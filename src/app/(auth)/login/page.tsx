'use client'
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Mail, Lock, LogIn, Loader2 } from 'lucide-react'

export default function LoginPage() {
  return (
    <Suspense><LoginContent /></Suspense>
  )
}

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const timeout = searchParams.get('reason') === 'timeout'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(timeout ? 'انتهت الجلسة بسبب عدم النشاط' : '')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!data.success) { setError(data.error || 'خطأ في تسجيل الدخول'); return }
      if (data.requires2FA) { window.location.href = '/verify-2fa'; return }
      // Send to root — middleware redirects to the correct landing per role.
      window.location.href = '/'
    } catch {
      setError('خطأ في الاتصال بالخادم')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex relative overflow-hidden">
      {/* Left side - branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#0a2540] via-[#0c3155] to-[#0b406d] relative items-center justify-center p-12">
        {/* Background effects */}
        <div className="absolute inset-0 opacity-[0.03]">
          <div className="absolute inset-0" style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize: '32px 32px',
          }} />
        </div>
        <div className="absolute top-1/4 -left-32 w-[500px] h-[500px] bg-brand-400/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 -right-32 w-[400px] h-[400px] bg-blue-500/10 rounded-full blur-[100px]" />

        {/* Decorative hexagons matching logo */}
        <div className="absolute top-20 right-20 w-24 h-24 border border-white/5 rotate-12" style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }} />
        <div className="absolute bottom-32 left-16 w-16 h-16 border border-white/5 -rotate-6" style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }} />
        <div className="absolute top-40 left-32 w-8 h-8 bg-brand-400/10 rotate-45" style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }} />

        <div className="relative z-10 text-center max-w-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="ASH GROUP" className="mx-auto w-32 h-32 rounded-3xl object-contain bg-white/95 p-3 shadow-2xl shadow-black/30 mb-8" />
          <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">ASH GROUP</h1>
          <div className="w-16 h-1 bg-gradient-to-r from-brand-400 to-blue-400 mx-auto mb-4 rounded-full" />
          <p className="text-blue-200/70 text-lg font-light">Financial Services</p>
          <p className="text-blue-300/40 text-sm mt-6 leading-relaxed max-w-sm mx-auto">
            منصة إدارة الحركة المالية وتسوية المعاملات
          </p>

          {/* Stats decoration */}
          <div className="mt-12 grid grid-cols-3 gap-4">
            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/5">
              <p className="text-2xl font-bold text-white">24/7</p>
              <p className="text-[10px] text-blue-300/50 mt-1">مراقبة مستمرة</p>
            </div>
            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/5">
              <p className="text-2xl font-bold text-white">100%</p>
              <p className="text-[10px] text-blue-300/50 mt-1">دقة المطابقة</p>
            </div>
            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/5">
              <p className="text-2xl font-bold text-white">AES</p>
              <p className="text-[10px] text-blue-300/50 mt-1">تشفير البيانات</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right side - login form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-gradient-to-b from-gray-50 to-white relative">
        {/* Mobile logo */}
        <div className="lg:hidden absolute top-8 left-1/2 -translate-x-1/2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="ASH GROUP" className="w-16 h-16 rounded-xl object-contain bg-white p-1 shadow-lg" />
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900">مرحباً بك</h2>
            <p className="text-gray-400 mt-1">سجّل دخولك للمتابعة إلى لوحة التحكم</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">البريد الإلكتروني</label>
              <div className="relative">
                <Mail size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full pl-4 pr-11 py-3 rounded-xl border border-gray-200 bg-white text-sm
                    focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500
                    placeholder:text-gray-300 transition-all shadow-sm"
                  placeholder="example@company.com" required autoFocus
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">كلمة المرور</label>
              <div className="relative">
                <Lock size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full pl-4 pr-11 py-3 rounded-xl border border-gray-200 bg-white text-sm
                    focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500
                    placeholder:text-gray-300 transition-all shadow-sm"
                  placeholder="••••••••" required
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-xl animate-fade-in">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-3.5 rounded-xl font-semibold text-white text-sm
                bg-gradient-to-r from-[#0a2540] to-[#0c3d6e]
                hover:from-[#0c3050] hover:to-[#0e4a82]
                active:scale-[0.98] transition-all duration-200
                shadow-lg shadow-[#0a2540]/20
                disabled:opacity-50 disabled:cursor-not-allowed
                flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <>
                  <LogIn size={18} />
                  تسجيل الدخول
                </>
              )}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            ليس لديك حساب؟{' '}
            <a href="/signup" className="text-[#0a2540] font-semibold hover:underline">
              إنشاء حساب جديد
            </a>
          </p>

          <p className="text-center text-[11px] text-gray-300 mt-8">
            ASH GROUP Financial Services v1.0
          </p>
        </div>
      </div>
    </div>
  )
}
