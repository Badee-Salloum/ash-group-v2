'use client'
// Phase G — per-employee custom permission overrides (admin only UI).

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Loader2, Search, ShieldCheck, ShieldOff, Shield, UserCircle, RefreshCw } from 'lucide-react'
import { PERMISSION_CATEGORIES, type PermissionKey } from '@/lib/permissions/keys'
import { hasPermission } from '@/lib/permissions/check'
import type { UserRole } from '@/lib/db/prisma-types'

interface EmployeeRow {
  id: string
  name: string
  role: UserRole
  jobTitle: string | null
  employeeCode: string | null
  avatarUrl: string | null
  isActive: boolean
}

interface OverrideRow {
  permissionKey: string
  isAllowed: boolean
  reason: string | null
  createdAt: string
}

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: 'مدير عام',
  MANAGER: 'مدير فرع',
  SUPERVISOR: 'مشرف',
  ACCOUNT_MGR: 'مدير حساب',
  EMPLOYEE: 'موظف',
  SHIFT_MANAGER: 'مدير نوبة',
}

const ROLE_BADGE: Record<UserRole, string> = {
  ADMIN: 'bg-rose-100 text-rose-700',
  MANAGER: 'bg-blue-100 text-blue-700',
  SUPERVISOR: 'bg-amber-100 text-amber-700',
  ACCOUNT_MGR: 'bg-purple-100 text-purple-700',
  EMPLOYEE: 'bg-gray-100 text-gray-700',
  SHIFT_MANAGER: 'bg-teal-100 text-teal-700',
}

export default function PermissionsPage() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [overrideCounts, setOverrideCounts] = useState<Record<string, number>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [overrides, setOverrides] = useState<OverrideRow[]>([])
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingOverrides, setLoadingOverrides] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const selected = useMemo(
    () => employees.find(e => e.id === selectedId) || null,
    [employees, selectedId],
  )

  const overrideMap = useMemo(() => {
    const m: Record<string, boolean> = {}
    for (const o of overrides) m[o.permissionKey] = o.isAllowed
    return m
  }, [overrides])

  const loadEmployees = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/employees')
      const d = await r.json()
      if (d.success) setEmployees(d.data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadOverrides = useCallback(async (userId: string) => {
    setLoadingOverrides(true)
    try {
      const r = await fetch(`/api/permissions/overrides?userId=${userId}`)
      const d = await r.json()
      if (d.success) {
        setOverrides(d.overrides || [])
        setOverrideCounts(c => ({ ...c, [userId]: (d.overrides || []).length }))
      } else {
        setMsg('تعذّر جلب التجاوزات: ' + (d.error || ''))
      }
    } finally {
      setLoadingOverrides(false)
    }
  }, [])

  useEffect(() => { loadEmployees() }, [loadEmployees])
  useEffect(() => {
    if (selectedId) {
      setOverrides([])
      setReason('')
      loadOverrides(selectedId)
    }
  }, [selectedId, loadOverrides])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return employees
    return employees.filter(e =>
      e.name.toLowerCase().includes(q) ||
      (e.jobTitle || '').toLowerCase().includes(q) ||
      (e.employeeCode || '').toLowerCase().includes(q)
    )
  }, [employees, search])

  async function setOverride(key: PermissionKey, mode: 'default' | 'allow' | 'deny') {
    if (!selectedId) return
    setSavingKey(key); setMsg('')
    try {
      if (mode === 'default') {
        const res = await fetch(`/api/permissions/overrides?userId=${selectedId}&permissionKey=${encodeURIComponent(key)}`, {
          method: 'DELETE',
        })
        const d = await res.json()
        if (!d.success) throw new Error(d.error)
      } else {
        const res = await fetch('/api/permissions/overrides', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: selectedId,
            permissionKey: key,
            isAllowed: mode === 'allow',
            reason: reason.trim() || undefined,
          }),
        })
        const d = await res.json()
        if (!d.success) throw new Error(d.error)
      }
      await loadOverrides(selectedId)
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">صلاحيات مخصّصة لكل موظف</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          أضف أو امنع صلاحيات محدّدة لموظف بعينه دون تغيير الدور — يفيد للحالات الاستثنائية.
        </p>
      </div>

      {msg && (
        <div className={`text-sm px-4 py-2 rounded-lg ${msg.startsWith('خطأ') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {msg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px,1fr] gap-4">
        {/* Employees list */}
        <div className="card p-3 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
          <div className="relative">
            <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              placeholder="بحث..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input py-1.5 pr-8 text-sm"
            />
          </div>
          {loading ? (
            <div className="p-6 text-center text-gray-400">
              <Loader2 size={20} className="mx-auto animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-xs">لا يوجد موظفون</div>
          ) : (
            <ul className="space-y-1">
              {filtered.map(e => {
                const count = overrideCounts[e.id] ?? 0
                const isSel = selectedId === e.id
                return (
                  <li key={e.id}>
                    <button
                      onClick={() => setSelectedId(e.id)}
                      className={`w-full text-right rounded-lg px-2.5 py-2 flex items-center gap-2 transition-colors ${
                        isSel ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'
                      }`}
                    >
                      {e.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={e.avatarUrl} alt={e.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white flex items-center justify-center font-bold text-[11px] shrink-0">
                          {e.name.charAt(0)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0 text-right">
                        <p className="font-medium text-gray-900 truncate text-xs">{e.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`badge text-[9px] ${ROLE_BADGE[e.role]}`}>{ROLE_LABEL[e.role]}</span>
                          {count > 0 && (
                            <span className="text-[9px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                              {count} تجاوز
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Permission matrix */}
        <div className="card p-5 min-h-[400px]">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 py-16">
              <UserCircle size={48} className="text-gray-300 mb-3" />
              <p className="text-sm">اختر موظفاً من القائمة على اليمين لإدارة صلاحياته.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 flex-wrap pb-3 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  {selected.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selected.avatarUrl} alt={selected.name} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white flex items-center justify-center font-bold">
                      {selected.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <p className="font-bold text-gray-900">{selected.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`badge text-[10px] ${ROLE_BADGE[selected.role]}`}>{ROLE_LABEL[selected.role]}</span>
                      <span className="text-[11px] text-gray-500">
                        إجمالي التجاوزات: <span className="font-bold text-amber-700">{overrides.length}</span>
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => selectedId && loadOverrides(selectedId)}
                  className="btn-secondary btn-sm"
                  title="تحديث"
                >
                  {loadingOverrides ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                </button>
              </div>

              {/* Optional reason */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  سبب التجاوز (اختياري — يُحفظ مع كل تعديل)
                </label>
                <input
                  className="input text-sm"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="مثلاً: استثناء مؤقت لتغطية الإجازة"
                />
              </div>

              {/* Categories */}
              {PERMISSION_CATEGORIES.map(cat => (
                <div key={cat.title} className="space-y-2">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{cat.title}</h3>
                  <div className="border border-gray-100 rounded-xl divide-y divide-gray-50">
                    {cat.keys.map(k => {
                      const roleGrants = hasPermission(selected.role, k.key)
                      const hasOverride = k.key in overrideMap
                      const overrideAllow = overrideMap[k.key]
                      const effective = hasOverride ? overrideAllow : roleGrants
                      const mode: 'default' | 'allow' | 'deny' = !hasOverride
                        ? 'default'
                        : overrideAllow ? 'allow' : 'deny'
                      const busy = savingKey === k.key

                      return (
                        <div key={k.key} className="px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-gray-800">{k.label}</p>
                              {effective ? (
                                <ShieldCheck size={13} className="text-emerald-500" />
                              ) : (
                                <ShieldOff size={13} className="text-gray-300" />
                              )}
                            </div>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {roleGrants
                                ? '(الدور يمنح هذه الصلاحية افتراضياً)'
                                : '(الدور يحرم هذه الصلاحية افتراضياً)'}
                              <span className="font-mono text-gray-300 mr-2">{k.key}</span>
                            </p>
                          </div>
                          <div className="inline-flex rounded-lg bg-gray-50 p-0.5 text-[11px] shrink-0">
                            <button
                              disabled={busy || mode === 'default'}
                              onClick={() => setOverride(k.key, 'default')}
                              className={`px-2.5 py-1 rounded-md transition-colors ${
                                mode === 'default'
                                  ? 'bg-white shadow-sm text-gray-800 font-bold'
                                  : 'text-gray-500 hover:bg-white'
                              }`}
                            >
                              <Shield size={11} className="inline ml-1 -mt-0.5" />
                              افتراضي الدور
                            </button>
                            <button
                              disabled={busy || mode === 'allow'}
                              onClick={() => setOverride(k.key, 'allow')}
                              className={`px-2.5 py-1 rounded-md transition-colors ${
                                mode === 'allow'
                                  ? 'bg-emerald-500 text-white font-bold shadow-sm'
                                  : 'text-emerald-700 hover:bg-emerald-50'
                              }`}
                            >
                              <ShieldCheck size={11} className="inline ml-1 -mt-0.5" />
                              مسموح
                            </button>
                            <button
                              disabled={busy || mode === 'deny'}
                              onClick={() => setOverride(k.key, 'deny')}
                              className={`px-2.5 py-1 rounded-md transition-colors ${
                                mode === 'deny'
                                  ? 'bg-rose-500 text-white font-bold shadow-sm'
                                  : 'text-rose-700 hover:bg-rose-50'
                              }`}
                            >
                              <ShieldOff size={11} className="inline ml-1 -mt-0.5" />
                              ممنوع
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
