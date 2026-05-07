'use client'
import { useEffect, useState, useCallback } from 'react'
import DataTable, { Column } from '@/components/tables/DataTable'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { fmtSyriaDate } from '@/lib/datetime'
import { fmtSYP } from '@/lib/currency'

interface Expense {
  id: string; description: string; amount: number; category: string | null
  expenseDate: string; createdBy: { name: string }
}

const CATEGORIES = ['إيجار', 'رواتب', 'مرافق', 'تسويق', 'تقنية', 'متنوع']

export default function ExpensesPage() {
  const [data, setData] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [form, setForm] = useState({ description: '', amount: '', category: '', expenseDate: '' })
  const [saving, setSaving] = useState(false)
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/expenses?pageSize=200')
    const d = await res.json()
    if (d.success) {
      setData(d.data)
      setTotal(d.data.reduce((s: number, e: Expense) => s + Number(e.amount), 0))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openNew() {
    setEditing(null)
    setForm({ description: '', amount: '', category: '', expenseDate: new Date().toISOString().slice(0, 10) })
    setShowForm(true)
  }

  function openEdit(e: Expense) {
    setEditing(e)
    setForm({
      description: e.description,
      amount: String(e.amount),
      category: e.category || '',
      expenseDate: e.expenseDate.slice(0, 10),
    })
    setShowForm(true)
  }

  async function handleSave(ev: React.FormEvent) {
    ev.preventDefault()
    setSaving(true)
    try {
      const body = {
        ...(editing ? { id: editing.id } : {}),
        description: form.description,
        amount: parseFloat(form.amount),
        category: form.category || undefined,
        expenseDate: form.expenseDate,
      }
      const res = await fetch('/api/expenses', {
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

  async function handleDelete(id: string) {
    if (!confirm('هل تريد حذف هذه الصرفية؟')) return
    await fetch('/api/expenses', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    load()
  }

  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'expenseDate',
      header: 'التاريخ',
      render: row => fmtSyriaDate(row.expenseDate as string),
    },
    { key: 'description', header: 'الوصف' },
    { key: 'category', header: 'الفئة', render: row => (row.category as string) || '—' },
    {
      key: 'amount',
      header: 'المبلغ',
      render: row => (
        <span className="font-mono font-medium text-gray-800">
          {fmtSYP(Number(row.amount))}
        </span>
      ),
    },
    {
      key: 'createdBy',
      header: 'أُدخل بواسطة',
      render: row => (row.createdBy as { name: string })?.name || '—',
    },
    {
      key: 'actions',
      header: '',
      sortable: false,
      render: row => (
        <div className="flex items-center gap-1">
          <button onClick={() => openEdit(row as unknown as Expense)} className="btn-ghost btn-sm p-1.5">
            <Pencil size={14} />
          </button>
          <button onClick={() => handleDelete(row.id as string)} className="btn-ghost btn-sm p-1.5 text-red-500 hover:bg-red-50">
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">الصرفيات</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            الإجمالي: <span className="font-mono font-semibold text-red-600">{fmtSYP(total)}</span>
          </p>
        </div>
        <button onClick={openNew} className="btn-primary">
          <Plus size={16} /> إضافة صرفية
        </button>
      </div>

      <DataTable
        data={data as unknown as Record<string, unknown>[]}
        columns={columns}
        loading={loading}
        exportFilename="expenses"
        emptyMessage="لا توجد صرفيات مسجلة"
      />

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">{editing ? 'تعديل صرفية' : 'إضافة صرفية'}</h2>
              <button onClick={() => setShowForm(false)} className="btn-ghost p-1.5">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">الوصف *</label>
                <input className="input" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">المبلغ *</label>
                  <input type="number" step="0.01" min="0" className="input" value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">التاريخ *</label>
                  <input type="date" className="input" value={form.expenseDate}
                    onChange={e => setForm(f => ({ ...f, expenseDate: e.target.value }))} required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">الفئة</label>
                <select className="input" value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  <option value="">— بدون فئة —</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
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
