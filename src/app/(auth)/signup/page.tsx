'use client'
import { useState } from 'react'
import Link from 'next/link'
import { User, Lock, UserPlus, Loader2, CheckCircle2 } from 'lucide-react'

export default function SignupPage() {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (name.trim().length < 2) {
      setError('الاسم يجب أن يكون حرفين على الأقل')
      return
    }
    if (password.length < 8) {
      setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل')
      return
    }
    if (password !== confirm) {
      setError('كلمتا المرور غير متطابقتين')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), password }),
      })
      const data = await res.json()
      if (!data.success) {
        setError(data.error || 'تعذّر إنشاء الحساب')
        return
      }
      setSuccess(true)
    } catch {
      setError('خطأ في الاتصال بالخادم')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="mx-auto w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-5">
            <CheckCircle2 size={36} className="text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-3">تم إنشاء الحساب بنجاح</h1>
          <p className="text-slate-600 leading-relaxed mb-2">
            حسابك الآن بانتظار <strong>تفعيل من الإدارة</strong>.
          </p>
          <p className="text-slate-500 text-sm leading-relaxed mb-6">
            ستتمكن من تسجيل الدخول بعد تفعيل الحساب. يرجى التواصل مع الإدارة إذا تأخر التفعيل.
          </p>
          <Link
            href="/login"
            className="inline-block w-full py-3 rounded-xl font-semibold text-white text-sm
              bg-gradient-to-r from-[#0a2540] to-[#0c3d6e]
              hover:from-[#0c3050] hover:to-[#0e4a82]
              transition-all shadow-lg shadow-[#0a2540]/20"
          >
            العودة إلى تسجيل الدخول
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <div className="mx-auto w-14 h-14 bg-gradient-to-br from-[#0a2540] to-[#0c3d6e] rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-[#0a2540]/20">
            <UserPlus size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1.5">إنشاء حساب جديد</h1>
          <p className="text-slate-500 text-sm">
            أدخل اسمك وكلمة المرور — الحساب يُفعَّل من الإدارة
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              الاسم الكامل
            </label>
            <div className="relative">
              <User size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full pl-4 pr-11 py-3 rounded-xl border border-gray-200 bg-white text-sm
                  focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500
                  placeholder:text-gray-300 transition-all shadow-sm"
                placeholder="أحمد محمد"
                required
                autoComplete="name"
                maxLength={80}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              اكتب اسمك كما هو مسجّل في الشركة لتسريع التفعيل
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              كلمة المرور
            </label>
            <div className="relative">
              <Lock size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full pl-4 pr-11 py-3 rounded-xl border border-gray-200 bg-white text-sm
                  focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500
                  placeholder:text-gray-300 transition-all shadow-sm"
                placeholder="••••••••"
                required
                autoComplete="new-password"
                minLength={8}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              8 أحرف على الأقل
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              تأكيد كلمة المرور
            </label>
            <div className="relative">
              <Lock size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="w-full pl-4 pr-11 py-3 rounded-xl border border-gray-200 bg-white text-sm
                  focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500
                  placeholder:text-gray-300 transition-all shadow-sm"
                placeholder="••••••••"
                required
                autoComplete="new-password"
                minLength={8}
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-xl">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
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
                <UserPlus size={18} />
                إنشاء الحساب
              </>
            )}
          </button>

          <p className="text-center text-sm text-gray-500 pt-2">
            لديك حساب بالفعل؟{' '}
            <Link href="/login" className="text-[#0a2540] font-semibold hover:underline">
              تسجيل الدخول
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
