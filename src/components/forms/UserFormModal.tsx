'use client'
import { useState, useEffect } from 'react'
import { X, Save, Loader2, User as UserIcon } from 'lucide-react'
import { fmtSYP } from '@/lib/currency'

// Shared "add/edit user" form used by both /employees and /users.
// `mode` controls which optional sections are shown:
//   - 'employee'  → HR fields (employeeCode, jobTitle, hireDate, baseSalary, phone, …)
//   - 'account'   → system-account fields (accountIds for ACCOUNT_MGR role)
// Both modes hit /api/employees (the canonical User-create endpoint, which
// supports the full superset). The page that opens the modal decides which
// roles to offer in the role select.

export type UserFormMode = 'employee' | 'account'

export interface UserFormRecord {
  id: string
  name: string
  email: string
  role: string
  employeeCode?: string | null
  jobTitle?: string | null
  hireDate?: string | null
  baseSalary?: number | null
  phone?: string | null
  address?: string | null
  avatarUrl?: string | null
  managerId?: string | null
  accountIds?: string[]
}

interface Props {
  open: boolean
  mode: UserFormMode
  editing?: UserFormRecord | null
  roleOptions: Array<{ value: string; label: string }>
  managers?: Array<{ id: string; name: string; jobTitle?: string | null }>
  accounts?: Array<{ id: string; name: string }>
  onClose: () => void
  onSaved: () => void
}

interface FormState {
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
  accountIds: Set<string>
}

function emptyForm(defaultRole: string): FormState {
  return {
    name: '', email: '', password: '', role: defaultRole,
    employeeCode: '', jobTitle: '', hireDate: '', baseSalary: '',
    phone: '', address: '', avatarUrl: '', managerId: '',
    accountIds: new Set<string>(),
  }
}

export default function UserFormModal({ open, mode, editing, roleOptions, managers, accounts, onClose, onSaved }: Props) {
  const defaultRole = roleOptions[0]?.value || 'EMPLOYEE'
  const [form, setForm] = useState<FormState>(() => emptyForm(defaultRole))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    if (editing) {
      setForm({
        name: editing.name,
        email: editing.email,
        password: '',
        role: editing.role,
        employeeCode: editing.employeeCode || '',
        jobTitle: editing.jobTitle || '',
        hireDate: editing.hireDate ? editing.hireDate.slice(0, 10) : '',
        baseSalary: editing.baseSalary != null ? String(editing.baseSalary) : '',
        phone: editing.phone || '',
        address: editing.address || '',
        avatarUrl: editing.avatarUrl || '',
        managerId: editing.managerId || '',
        accountIds: new Set(editing.accountIds || []),
      })
    } else {
      setForm(emptyForm(defaultRole))
    }
    setError('')
  }, [open, editing, defaultRole])

  if (!open) return null

  const showHR = mode === 'employee'
  const showAccountPicker = mode === 'account' && form.role === 'ACCOUNT_MGR'

  // Manager dropdown excludes self + descendants (cycle prevention)
  const managerOptions = (() => {
    if (!managers || mode !== 'employee') return []
    if (!editing) return managers
    const blocked = new Set<string>([editing.id])
    // managers[] does not have managerId hierarchy here, so we just block self.
    // Server still enforces a deeper cycle check.
    return managers.filter(m => !blocked.has(m.id))
  })()

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        email: form.email,
        role: form.role,
      }
      if (form.password) payload.password = form.password
      if (showHR) {
        if (form.employeeCode) payload.employeeCode = form.employeeCode
        if (form.jobTitle) payload.jobTitle = form.jobTitle
        if (form.hireDate) payload.hireDate = form.hireDate
        if (form.baseSalary) payload.baseSalary = parseFloat(form.baseSalary)
        if (form.phone) payload.phone = form.phone
        if (form.address) payload.address = form.address
        if (form.avatarUrl) payload.avatarUrl = form.avatarUrl
        payload.managerId = form.managerId || null
      }
      if (showAccountPicker) {
        payload.accountIds = Array.from(form.accountIds)
      }
      if (editing) payload.id = editing.id

      const res = await fetch('/api/employees', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'فشل الحفظ')
      onSaved()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  function toggleAccountId(id: string) {
    setForm(f => {
      const n = new Set(f.accountIds)
      if (n.has(id)) n.delete(id); else n.add(id)
      return { ...f, accountIds: n }
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 sticky top-0 bg-white flex items-center justify-between z-10">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <UserIcon size={18} />
            {editing ? 'تعديل' : 'إضافة'} {mode === 'employee' ? 'موظف' : 'حساب'}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>
        <form onSubmit={handleSave} className="p-6 space-y-4" autoComplete="off">
          {/* Hidden dummy fields trick browsers into ignoring autofill on the
              real inputs below. Without this, Chrome ignores autoComplete=off
              on the email/password inputs and pastes the saved login. */}
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
              <label className="block text-sm font-medium text-gray-700 mb-1">الدور *</label>
              <select className="input" value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {roleOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                كلمة المرور {editing ? '(فارغ = إبقاء الحالية)' : '(اختياري)'}
              </label>
              <input type="password" className="input" value={form.password}
                placeholder="8 أحرف على الأقل"
                autoComplete="new-password"
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            </div>

            {showHR && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">رمز الموظف</label>
                  <input className="input font-mono" value={form.employeeCode}
                    placeholder="EMP-XXXX (تلقائي)"
                    onChange={e => setForm(f => ({ ...f, employeeCode: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">المسمى الوظيفي</label>
                  <input className="input" value={form.jobTitle}
                    onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">المدير المباشر</label>
                  <select className="input" value={form.managerId}
                    onChange={e => setForm(f => ({ ...f, managerId: e.target.value }))}>
                    <option value="">— لا يوجد —</option>
                    {managerOptions.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name}{m.jobTitle ? ` (${m.jobTitle})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ التعيين</label>
                  <input type="date" className="input" value={form.hireDate}
                    onChange={e => setForm(f => ({ ...f, hireDate: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الراتب الأساسي (ل.س)</label>
                  <input type="number" step="1000" className="input font-mono" value={form.baseSalary}
                    onChange={e => setForm(f => ({ ...f, baseSalary: e.target.value }))} />
                  {form.baseSalary && (
                    <p className="text-[10px] text-gray-400 mt-1">{fmtSYP(parseFloat(form.baseSalary))}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">رقم الهاتف</label>
                  <input className="input" value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">العنوان</label>
                  <input className="input" value={form.address}
                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">رابط الصورة</label>
                  <input className="input" value={form.avatarUrl}
                    placeholder="https://..."
                    onChange={e => setForm(f => ({ ...f, avatarUrl: e.target.value }))} />
                </div>
              </>
            )}

            {showAccountPicker && accounts && accounts.length > 0 && (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  الحسابات المتاحة ({form.accountIds.size})
                </label>
                <div className="border border-gray-200 rounded-xl p-2 max-h-48 overflow-y-auto space-y-1">
                  {accounts.map(a => (
                    <label key={a.id} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
                      <input type="checkbox" checked={form.accountIds.has(a.id)}
                        onChange={() => toggleAccountId(a.id)} />
                      <span className="text-sm">{a.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'جاري الحفظ...' : 'حفظ'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
