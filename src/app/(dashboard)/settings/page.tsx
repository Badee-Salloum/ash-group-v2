'use client'
import { useState, useEffect } from 'react'
import { Save, Settings, Shield, ShieldOff, Loader2, CalendarDays, Key } from 'lucide-react'

export default function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Settings size={22} /> الإعدادات
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Settings</p>
      </div>

      {/* Change own password — every logged-in user */}
      <ChangePasswordSection />

      {/* 2FA Settings */}
      <TwoFactorSection />

      {/* Global defaults — ADMIN only */}
      <GlobalDefaultsSection />

      {/* Session info */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-700 mb-3">معلومات الجلسة</h2>
        <div className="space-y-2 text-sm text-gray-600">
          <p>مدة الجلسة: <span className="font-medium">8 ساعات</span></p>
          <p>انتهاء التلقائي عند الخمول: <span className="font-medium">30 دقيقة</span></p>
          <p>الحد الأقصى لمحاولات الدخول: <span className="font-medium">5 محاولات</span></p>
          <p>مدة الحجب عند التجاوز: <span className="font-medium">30 دقيقة</span></p>
        </div>
      </div>
    </div>
  )
}

function TwoFactorSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [setupData, setSetupData] = useState<{ secret: string; qrCodeUrl: string } | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    fetch('/api/users').then(r => r.json()).then(d => {
      // Check current user 2FA status from session info
    }).catch(() => {})
    // We'll detect from setup response
    setEnabled(false)
  }, [])

  async function startSetup() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/auth/2fa/setup', { method: 'POST' })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setSetupData(d.data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function confirmSetup() {
    if (verifyCode.length !== 6 || !setupData) return
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: setupData.secret, token: verifyCode }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setEnabled(true)
      setSetupData(null)
      setVerifyCode('')
      setSuccess('تم تفعيل المصادقة الثنائية بنجاح')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleDisable() {
    if (disableCode.length !== 6) return
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: disableCode }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setEnabled(false)
      setDisableCode('')
      setSuccess('تم إلغاء المصادقة الثنائية')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Shield size={18} className="text-blue-600" />
        <h2 className="font-semibold text-gray-700">المصادقة الثنائية (2FA)</h2>
      </div>

      {success && <p className="text-green-600 text-sm">{success}</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {enabled ? (
        <div className="space-y-3">
          <p className="text-sm text-green-700 flex items-center gap-1">
            <Shield size={14} /> المصادقة الثنائية مفعلة
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="input w-40 font-mono text-center"
              placeholder="رمز التحقق"
              value={disableCode}
              onChange={e => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <button onClick={handleDisable} disabled={loading || disableCode.length !== 6} className="btn-danger btn-sm">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <ShieldOff size={14} />}
              إلغاء التفعيل
            </button>
          </div>
        </div>
      ) : setupData ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">امسح رمز QR بتطبيق المصادقة (Google Authenticator أو مشابه):</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setupData.qrCodeUrl} alt="QR Code" className="mx-auto w-48 h-48" />
          <p className="text-xs text-gray-400 text-center font-mono break-all">
            المفتاح: {setupData.secret}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="input w-40 font-mono text-center"
              placeholder="رمز التحقق"
              value={verifyCode}
              onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <button onClick={confirmSetup} disabled={loading || verifyCode.length !== 6} className="btn-primary btn-sm">
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              تأكيد التفعيل
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm text-gray-500 mb-3">المصادقة الثنائية غير مفعلة</p>
          <button onClick={startSetup} disabled={loading} className="btn-primary btn-sm">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
            تفعيل المصادقة الثنائية
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Change own password ──────────────────────────────────────────────────
function ChangePasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState(0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (next.length < 8) { setError('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل'); return }
    if (next !== confirm) { setError('تأكيد كلمة المرور غير مطابق'); return }
    if (next === current) { setError('كلمة المرور الجديدة يجب أن تختلف عن الحالية'); return }

    setBusy(true)
    try {
      const res = await fetch('/api/me/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'فشل تغيير كلمة المرور')
      setCurrent(''); setNext(''); setConfirm('')
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(0), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Key size={18} className="text-amber-600" />
        <h2 className="font-semibold text-gray-700">تغيير كلمة المرور</h2>
      </div>
      <form onSubmit={submit} className="space-y-3" autoComplete="off">
        <input type="text" name="prevent-autofill" autoComplete="off" style={{ display: 'none' }} />
        <input type="password" name="prevent-autofill-pw" autoComplete="new-password" style={{ display: 'none' }} />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">كلمة المرور الحالية</label>
          <input type="password" className="input" autoComplete="current-password"
            value={current} onChange={e => setCurrent(e.target.value)} required />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">كلمة المرور الجديدة</label>
            <input type="password" className="input" autoComplete="new-password"
              placeholder="8 أحرف على الأقل"
              value={next} onChange={e => setNext(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">تأكيد كلمة المرور</label>
            <input type="password" className="input" autoComplete="new-password"
              value={confirm} onChange={e => setConfirm(e.target.value)} required />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        {savedAt > 0 && <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">تم تغيير كلمة المرور بنجاح ✓</p>}

        <div className="flex justify-end">
          <button type="submit" disabled={busy} className="btn-primary btn-sm">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            تغيير كلمة المرور
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Global defaults (ADMIN-only) ─────────────────────────────────────────
function GlobalDefaultsSection() {
  const [role, setRole] = useState<string>('')
  const [offDays, setOffDays] = useState<string>('1')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/me').then(r => r.json()).catch(() => null),
      fetch('/api/settings/global').then(r => r.json()).catch(() => null),
    ]).then(([me, settings]) => {
      if (me?.success) setRole(me.role)
      if (settings?.success) setOffDays(String(settings.data.defaultWeeklyOffDays ?? 1))
      setLoading(false)
    })
  }, [])

  // Hide entirely for non-admins.
  if (loading) return null
  if (role !== 'ADMIN') return null

  async function save() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/settings/global', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultWeeklyOffDays: parseInt(offDays, 10) }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'فشل الحفظ')
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(0), 2500)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <CalendarDays size={18} className="text-blue-600" />
        <h2 className="font-semibold text-gray-700">الإعدادات العامة</h2>
        <span className="text-[10px] text-gray-400 mr-auto">ADMIN فقط</span>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          أيام العطلة الأسبوعية الافتراضية
        </label>
        <p className="text-xs text-gray-500 mb-2">
          تُطبَّق على جميع الموظفين عند احتساب الراتب اليومي. (راتب اليوم = الراتب الأسبوعي ÷ {Math.max(1, 7 - parseInt(offDays || '1', 10))} أيام دوام)
        </p>
        <div className="flex items-center gap-2">
          <select className="input max-w-xs" value={offDays} onChange={e => setOffDays(e.target.value)}>
            {[0, 1, 2, 3].map(n => (
              <option key={n} value={String(n)}>
                {n === 0 ? 'لا يوجد' : `${n} ${n === 1 ? 'يوم' : 'أيام'}`} ({7 - n} أيام دوام)
              </option>
            ))}
          </select>
          <button onClick={save} disabled={saving} className="btn-primary btn-sm">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            حفظ
          </button>
          {savedAt > 0 && <span className="text-xs text-green-600">تم الحفظ ✓</span>}
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>
    </div>
  )
}
