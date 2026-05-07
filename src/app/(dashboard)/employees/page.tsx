'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import DataTable, { Column } from '@/components/tables/DataTable'
import { fmtSyriaDate } from '@/lib/datetime'
import { fmtSYP } from '@/lib/currency'
import { UserPlus, Edit2, Trash2, GitBranch, X, Save, Loader2, User as UserIcon, Wallet, Key, Copy, Check } from 'lucide-react'

interface Employee extends Record<string, unknown> {
  id: string
  name: string
  email: string
  role: string
  employeeCode: string | null
  jobTitle: string | null
  hireDate: string | null
  baseSalary: number | null
  phone: string | null
  address: string | null
  avatarUrl: string | null
  managerId: string | null
  manager: { id: string; name: string; jobTitle: string | null } | null
  subordinateCount: number
  isActive: boolean
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'مدير عام',
  SUPERVISOR: 'مشرف',
  ACCOUNT_MGR: 'مدير حساب',
  MANAGER: 'مدير فرع',
  EMPLOYEE: 'موظف',
}

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-purple-100 text-purple-800',
  MANAGER: 'bg-indigo-100 text-indigo-800',
  SUPERVISOR: 'bg-green-100 text-green-800',
  ACCOUNT_MGR: 'bg-amber-100 text-amber-800',
  EMPLOYEE: 'bg-gray-100 text-gray-800',
}

interface FormData {
  id?: string
  name: string
  email: string
  password: string
  role: string
  employeeCode: string
  jobTitle: string
  hireDate: string
  baseSalary: string
  phone: string
  address: string
  avatarUrl: string
  managerId: string
}

const emptyForm: FormData = {
  name: '', email: '', password: '', role: 'EMPLOYEE',
  employeeCode: '', jobTitle: '', hireDate: '', baseSalary: '',
  phone: '', address: '', avatarUrl: '', managerId: '',
}

export default function EmployeesPage() {
  const [data, setData] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [myRole, setMyRole] = useState<string>('')
  const [resetTarget, setResetTarget] = useState<Employee | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/employees')
    const d = await r.json()
    if (d.success) setData(d.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Detect current user's role to scope UI (مدير الفرع = MANAGER → employees only).
  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(d => { if (d.success) setMyRole(d.role) }).catch(() => {})
  }, [])

  const isManagerScope = myRole === 'MANAGER'

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setShowForm(true)
  }

  function openEdit(emp: Employee) {
    setEditing(emp)
    setForm({
      id: emp.id,
      name: emp.name,
      email: emp.email,
      password: '',
      role: emp.role,
      employeeCode: emp.employeeCode || '',
      jobTitle: emp.jobTitle || '',
      hireDate: emp.hireDate ? emp.hireDate.slice(0, 10) : '',
      baseSalary: emp.baseSalary != null ? String(emp.baseSalary) : '',
      phone: emp.phone || '',
      address: emp.address || '',
      avatarUrl: emp.avatarUrl || '',
      managerId: emp.managerId || '',
    })
    setError('')
    setShowForm(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        email: form.email,
        role: form.role,
        employeeCode: form.employeeCode || undefined,
        jobTitle: form.jobTitle || undefined,
        hireDate: form.hireDate || undefined,
        baseSalary: form.baseSalary ? parseFloat(form.baseSalary) : undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        avatarUrl: form.avatarUrl || undefined,
        managerId: form.managerId || null,
      }
      if (form.password) payload.password = form.password
      if (editing) payload.id = editing.id

      const res = await fetch('/api/employees', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setShowForm(false); load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(emp: Employee) {
    if (!confirm(`هل أنت متأكد من تعطيل الموظف "${emp.name}"؟`)) return
    try {
      const res = await fetch(`/api/employees?id=${emp.id}`, { method: 'DELETE' })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      load()
    } catch (e) {
      alert('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const columns: Column<Employee>[] = [
    {
      key: 'name', header: 'الموظف',
      render: row => (
        <div className="flex items-center gap-2">
          {row.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.avatarUrl} alt={row.name} className="w-9 h-9 rounded-full object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white flex items-center justify-center font-bold text-xs">
              {row.name.charAt(0)}
            </div>
          )}
          <div>
            <p className="font-medium text-gray-900 text-sm">{row.name}</p>
            <p className="text-[10px] text-gray-400">{row.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'employeeCode', header: 'الرمز',
      render: row => <span className="font-mono text-xs text-gray-600">{row.employeeCode || '—'}</span>,
    },
    {
      key: 'jobTitle', header: 'المسمى الوظيفي',
      render: row => row.jobTitle || <span className="text-gray-400">—</span>,
    },
    {
      key: 'role', header: 'الدور',
      render: row => (
        <span className={`badge ${ROLE_COLORS[row.role] || 'bg-gray-100 text-gray-800'}`}>
          {ROLE_LABELS[row.role] || row.role}
        </span>
      ),
    },
    {
      key: 'manager', header: 'المدير المباشر',
      render: row => row.manager
        ? <span className="text-xs">{row.manager.name}</span>
        : <span className="text-gray-400 text-xs">—</span>,
    },
    {
      key: 'subordinateCount', header: 'مرؤوسون',
      render: row => row.subordinateCount > 0
        ? <span className="badge bg-blue-50 text-blue-700">{row.subordinateCount}</span>
        : <span className="text-gray-300 text-xs">—</span>,
    },
    {
      key: 'baseSalary', header: 'الراتب',
      sortAccessor: row => row.baseSalary || 0,
      render: row => row.baseSalary != null
        ? <span className="font-mono text-xs">{fmtSYP(Number(row.baseSalary))}</span>
        : <span className="text-gray-400">—</span>,
    },
    {
      key: 'hireDate', header: 'تاريخ التعيين',
      render: row => row.hireDate
        ? <span className="text-xs font-mono text-gray-600">{fmtSyriaDate(row.hireDate)}</span>
        : <span className="text-gray-400">—</span>,
    },
    {
      key: 'actions', header: 'إجراء', sortable: false,
      render: row => (
        <div className="flex items-center gap-1">
          <Link href={`/employees/${row.id}/wallets`} className="btn-ghost btn-sm p-1.5 text-emerald-600" title="إدارة المحافظ">
            <Wallet size={13} />
          </Link>
          <button onClick={() => openEdit(row)} className="btn-ghost btn-sm p-1.5 text-blue-600" title="تعديل">
            <Edit2 size={13} />
          </button>
          <button onClick={() => setResetTarget(row)} className="btn-ghost btn-sm p-1.5 text-amber-600" title="إعادة تعيين كلمة المرور">
            <Key size={13} />
          </button>
          {!isManagerScope && (
            <button onClick={() => handleDelete(row)} className="btn-ghost btn-sm p-1.5 text-red-600" title="تعطيل">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ),
    },
  ]

  // Stats
  const totalEmployees = data.length
  const managers = data.filter(d => d.role === 'MANAGER' || d.subordinateCount > 0).length
  const orphans = data.filter(d => !d.managerId && d.role !== 'ADMIN' && d.role !== 'MANAGER').length

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">إدارة الموظفين</h1>
          <p className="text-sm text-gray-500 mt-0.5">قائمة وإدارة موظفي الشركة</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/employees/tree" className="btn-secondary">
            <GitBranch size={16} /> الهيكل التنظيمي
          </Link>
          <button onClick={openCreate} className="btn-primary">
            <UserPlus size={16} /> موظف جديد
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-[10px] text-gray-400 font-bold uppercase">إجمالي الموظفين</p>
          <p className="text-2xl font-bold font-mono">{totalEmployees}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] text-indigo-500 font-bold uppercase">المديرون</p>
          <p className="text-2xl font-bold text-indigo-700 font-mono">{managers}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] text-amber-500 font-bold uppercase">بدون مدير</p>
          <p className="text-2xl font-bold text-amber-700 font-mono">{orphans}</p>
        </div>
      </div>

      <DataTable
        data={data}
        columns={columns}
        loading={loading}
        exportFilename="employees"
        emptyMessage="لا يوجد موظفون"
      />

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 sticky top-0 bg-white flex items-center justify-between">
              <h2 className="font-bold text-gray-800 flex items-center gap-2">
                <UserIcon size={18} /> {editing ? 'تعديل موظف' : 'موظف جديد'}
              </h2>
              <button onClick={() => setShowForm(false)} className="btn-ghost p-1.5"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4" autoComplete="off">
              {/* Block browser autofill — Chrome ignores autoComplete=off
                  unless we provide hidden honey-pot fields ahead of the real
                  email/password inputs. */}
              <input type="text" name="prevent-autofill" autoComplete="off" style={{ display: 'none' }} />
              <input type="password" name="prevent-autofill-pw" autoComplete="new-password" style={{ display: 'none' }} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الاسم *</label>
                  <input className="input" required value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">البريد الإلكتروني *</label>
                  <input type="email" className="input" required value={form.email}
                    autoComplete="off"
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">رمز الموظف</label>
                  <input className="input font-mono" value={form.employeeCode}
                    placeholder="EMP-XXXX (تلقائي إن تركته)"
                    onChange={e => setForm(f => ({ ...f, employeeCode: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">المسمى الوظيفي</label>
                  <input className="input" value={form.jobTitle}
                    onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الدور *</label>
                  {isManagerScope ? (
                    <input className="input bg-gray-50 text-gray-600" value={ROLE_LABELS.EMPLOYEE} readOnly />
                  ) : (
                    <select className="input" value={form.role}
                      onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                      {Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">المدير المباشر</label>
                  <select className="input" value={form.managerId}
                    onChange={e => setForm(f => ({ ...f, managerId: e.target.value }))}>
                    <option value="">— لا يوجد —</option>
                    {(() => {
                      // Exclude self + all descendants (cannot pick a subordinate as manager)
                      const blocked = new Set<string>()
                      if (editing) {
                        blocked.add(editing.id)
                        let changed = true
                        while (changed) {
                          changed = false
                          for (const e of data) {
                            if (e.managerId && blocked.has(e.managerId) && !blocked.has(e.id)) {
                              blocked.add(e.id); changed = true
                            }
                          }
                        }
                      }
                      return data.filter(e => !blocked.has(e.id)).map(e => (
                        <option key={e.id} value={e.id}>
                          {e.name}{e.jobTitle ? ` (${e.jobTitle})` : ''}
                        </option>
                      ))
                    })()}
                  </select>
                  {editing && <p className="text-[10px] text-gray-400 mt-1">لا يمكن اختيار مرؤوس مباشر أو غير مباشر كمدير.</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ التعيين</label>
                  <input type="date" className="input" value={form.hireDate}
                    onChange={e => setForm(f => ({ ...f, hireDate: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الراتب الأساسي (ل.س / أسبوع)</label>
                  <input type="number" step="1000" className="input font-mono" value={form.baseSalary}
                    onChange={e => setForm(f => ({ ...f, baseSalary: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">رقم الهاتف</label>
                  <input className="input" value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">رابط الصورة</label>
                  <input className="input" value={form.avatarUrl}
                    placeholder="https://..."
                    onChange={e => setForm(f => ({ ...f, avatarUrl: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">العنوان</label>
                  <input className="input" value={form.address}
                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    كلمة المرور {editing ? '(اتركها فارغة للإبقاء على الحالية)' : '(اختياري — كلمة افتراضية إن تركتها)'}
                  </label>
                  <input type="password" className="input" value={form.password}
                    placeholder="8 أحرف على الأقل"
                    autoComplete="new-password"
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                </div>
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {saving ? 'جاري الحفظ...' : 'حفظ'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1 justify-center">
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <ResetPasswordModal
          employee={resetTarget}
          onClose={() => setResetTarget(null)}
        />
      )}
    </div>
  )
}

// ─── Reset password modal ─────────────────────────────────────────────────
function ResetPasswordModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const body: Record<string, unknown> = { id: employee.id }
      if (mode === 'manual') {
        if (password.length < 8) throw new Error('كلمة المرور يجب أن تكون 8 أحرف على الأقل')
        body.password = password
      }
      const res = await fetch('/api/employees/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'فشل الطلب')
      if (d.data?.tempPassword) {
        setTempPassword(d.data.tempPassword)
      } else {
        // Manual mode — done.
        onClose()
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function copyPw() {
    if (!tempPassword) return
    try {
      await navigator.clipboard.writeText(tempPassword)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <Key size={18} className="text-amber-600" /> إعادة تعيين كلمة المرور
          </h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-700">
            للموظف: <span className="font-bold">{employee.name}</span>
            <span className="text-xs text-gray-400 mr-2">({employee.email})</span>
          </p>

          {tempPassword ? (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-xs text-amber-700 mb-2">كلمة المرور المؤقتة — انسخها وشاركها مع الموظف الآن:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-base bg-white px-3 py-2 rounded border border-amber-300 select-all">
                    {tempPassword}
                  </code>
                  <button onClick={copyPw} className="btn-secondary btn-sm" title="نسخ">
                    {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                  </button>
                </div>
                <p className="text-[10px] text-amber-600 mt-2">
                  لن يتم عرضها مرة أخرى — اطلب من الموظف تغييرها بعد أول دخول.
                </p>
              </div>
              <button onClick={onClose} className="btn-primary w-full justify-center">تم</button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => setMode('auto')}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${
                    mode === 'auto' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600'
                  }`}>
                  توليد تلقائي
                </button>
                <button type="button"
                  onClick={() => setMode('manual')}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${
                    mode === 'manual' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600'
                  }`}>
                  إدخال يدوي
                </button>
              </div>

              {mode === 'manual' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">كلمة المرور الجديدة</label>
                  <input type="password" className="input" autoComplete="new-password"
                    placeholder="8 أحرف على الأقل"
                    value={password}
                    onChange={e => setPassword(e.target.value)} />
                </div>
              ) : (
                <p className="text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded-lg">
                  سيتم توليد كلمة مرور عشوائية وعرضها لك مرة واحدة فقط.
                </p>
              )}

              {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={busy} className="btn-primary flex-1 justify-center">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
                  {busy ? 'جاري...' : 'إعادة تعيين'}
                </button>
                <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">إلغاء</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
