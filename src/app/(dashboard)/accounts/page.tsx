'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, Pencil, X, Building2 } from 'lucide-react'

interface Account {
  id: string; name: string; currency: string
  depositProfitRate?: number; withdrawalProfitRate?: number
  walletIdentifiers: string[]; isActive: boolean
}

const CURRENCIES = ['USD', 'EUR', 'TRY', 'SYP']

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [restricted, setRestricted] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [form, setForm] = useState({
    name: '', currency: 'USD',
    depositProfitRate: '', withdrawalProfitRate: '',
    walletIdentifiers: '',
  })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/accounts')
    const d = await res.json()
    if (d.success) {
      setAccounts(d.data)
      setRestricted(d.isRestricted === true)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openNew() {
    setEditing(null)
    setForm({ name: '', currency: 'USD', depositProfitRate: '', withdrawalProfitRate: '', walletIdentifiers: '' })
    setShowForm(true)
  }

  function openEdit(a: Account) {
    setEditing(a)
    setForm({
      name: a.name, currency: a.currency,
      depositProfitRate: String(a.depositProfitRate),
      withdrawalProfitRate: String(a.withdrawalProfitRate),
      walletIdentifiers: a.walletIdentifiers.join('\n'),
    })
    setShowForm(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        ...(editing ? { id: editing.id } : {}),
        name: form.name,
        currency: form.currency,
        depositProfitRate: parseFloat(form.depositProfitRate),
        withdrawalProfitRate: parseFloat(form.withdrawalProfitRate),
        walletIdentifiers: form.walletIdentifiers.split('\n').map(s => s.trim()).filter(Boolean),
      }
      const res = await fetch('/api/accounts', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setShowForm(false)
      load()
    } catch (err) { alert(String(err)) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">الحسابات</h1>
          <p className="text-sm text-gray-500 mt-0.5">Accounts</p>
        </div>
        {!restricted && (
          <button onClick={openNew} className="btn-primary"><Plus size={16} /> إضافة حساب</button>
        )}
      </div>

      {loading ? (
        <p className="text-gray-400 text-center py-12">جاري التحميل...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {accounts.map(a => (
            <div key={a.id} className="card p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
                    <Building2 size={18} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800">{a.name}</p>
                    <p className="text-xs text-gray-400">{a.currency}</p>
                  </div>
                </div>
                {!restricted && (
                  <button onClick={() => openEdit(a)} className="btn-ghost btn-sm p-1.5">
                    <Pencil size={14} />
                  </button>
                )}
              </div>
              {!restricted && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="bg-green-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-green-600 mb-1">نسبة ربح الإيداع</p>
                    <p className="font-bold text-green-700 text-lg">{a.depositProfitRate}%</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-blue-600 mb-1">نسبة ربح السحب</p>
                    <p className="font-bold text-blue-700 text-lg">{a.withdrawalProfitRate}%</p>
                  </div>
                </div>
              )}
              {a.walletIdentifiers.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1.5">أسماء الحسابات ({a.walletIdentifiers.length})</p>
                  <div className="flex flex-wrap gap-1">
                    {a.walletIdentifiers.slice(0, 3).map(w => (
                      <span key={w} className="badge bg-gray-200 text-gray-700 text-xs">{w.slice(0, 12)}...</span>
                    ))}
                    {a.walletIdentifiers.length > 3 && (
                      <span className="badge bg-gray-200 text-gray-600">+{a.walletIdentifiers.length - 3}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="font-semibold text-gray-800">{editing ? 'تعديل حساب' : 'إضافة حساب'}</h2>
              <button onClick={() => setShowForm(false)} className="btn-ghost p-1.5"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">اسم الحساب *</label>
                <input className="input" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              {/* العملة تُحدّد تلقائياً من الملفات المرفوعة */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">نسبة ربح الإيداع % *</label>
                  <input type="number" step="0.01" min="0" max="100" className="input"
                    value={form.depositProfitRate}
                    onChange={e => setForm(f => ({ ...f, depositProfitRate: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">نسبة ربح السحب % *</label>
                  <input type="number" step="0.01" min="0" max="100" className="input"
                    value={form.withdrawalProfitRate}
                    onChange={e => setForm(f => ({ ...f, withdrawalProfitRate: e.target.value }))} required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  أسماء الحسابات الخاصة بنا <span className="text-gray-400 font-normal">(كل اسم في سطر — يُستخدم لتصفية سحوبات شام كاش)</span>
                </label>
                <textarea className="input min-h-24 resize-y font-mono text-xs" value={form.walletIdentifiers}
                  onChange={e => setForm(f => ({ ...f, walletIdentifiers: e.target.value }))}
                  placeholder="اسم الحساب 1&#10;اسم الحساب 2" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
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
    </div>
  )
}
