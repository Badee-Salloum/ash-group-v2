'use client'
import { useState, useRef, useEffect, KeyboardEvent, ClipboardEvent, ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Shield, Loader2 } from 'lucide-react'

export default function Verify2FAPage() {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', ''])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])

  const code = digits.join('')

  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  function focusIndex(i: number) {
    const el = inputRefs.current[i]
    if (el) {
      el.focus()
      el.select()
    }
  }

  function handleChange(i: number, e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, '')
    if (!raw) {
      setDigits(prev => {
        const next = [...prev]
        next[i] = ''
        return next
      })
      return
    }
    // If user types multiple chars (e.g. via autofill/IME), spread them
    setDigits(prev => {
      const next = [...prev]
      for (let k = 0; k < raw.length && i + k < 6; k++) {
        next[i + k] = raw[k]
      }
      return next
    })
    const nextIdx = Math.min(i + raw.length, 5)
    focusIndex(nextIdx)
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      if (digits[i]) {
        setDigits(prev => {
          const next = [...prev]
          next[i] = ''
          return next
        })
      } else if (i > 0) {
        e.preventDefault()
        setDigits(prev => {
          const next = [...prev]
          next[i - 1] = ''
          return next
        })
        focusIndex(i - 1)
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault()
      focusIndex(i - 1)
    } else if (e.key === 'ArrowRight' && i < 5) {
      e.preventDefault()
      focusIndex(i + 1)
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!text) return
    e.preventDefault()
    const next = ['', '', '', '', '', '']
    for (let k = 0; k < text.length; k++) next[k] = text[k]
    setDigits(next)
    focusIndex(Math.min(text.length, 5))
  }

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
      router.push('/')
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
            <div className="flex justify-center gap-2" dir="ltr">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={el => { inputRefs.current[i] = el }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]"
                  maxLength={1}
                  value={d}
                  onChange={e => handleChange(i, e)}
                  onKeyDown={e => handleKeyDown(i, e)}
                  onPaste={handlePaste}
                  onFocus={e => e.currentTarget.select()}
                  className="w-11 h-14 text-center text-xl font-mono rounded-xl border border-gray-200 bg-white
                    focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500
                    shadow-sm transition-all"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                />
              ))}
            </div>

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
