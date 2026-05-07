'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Save, Loader2, Wallet } from 'lucide-react'

interface Account { id: string; name: string; currency: string }
interface Employee { id: string; name: string; jobTitle: string | null }

export default function EmployeeWalletsPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const empId = params?.id || ''

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [emp, accs, current] = await Promise.all([
      fetch('/api/employees').then(r => r.json()),
      fetch('/api/accounts').then(r => r.json()),
      fetch(`/api/employees/${empId}/wallets`).then(r => r.json()),
    ])
    if (emp.success) {
      const e = (emp.data as Employee[]).find(x => x.id === empId)
      if (e) setEmployee(e)
    }
    if (accs.success) setAccounts(accs.data || [])
    if (current.success) {
      setSelected(new Set((current.data as Array<{ account: { id: string } }>).map(a => a.account.id)))
    }
    setLoading(false)
  }, [empId])

  useEffect(() => { if (empId) load() }, [empId, load])

  function toggle(id: string) {
    setSelected(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  async function handleSave() {
    setSaving(true); setMsg('')
    try {
      const res = await fetch(`/api/employees/${empId}/wallets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds: Array.from(selected) }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setMsg(`تم حفظ ${d.count} محفظة`)
      setTimeout(() => router.push('/employees'), 1200)
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center p-20 text-gray-400 gap-2">
      <Loader2 size={20} className="animate-spin" /> جاري التحميل...
    </div>
  )

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/employees" className="btn-secondary btn-sm">
          <ArrowRight size={14} /> الموظفون
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">المحافظ المُسندة</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {employee ? `${employee.name}${employee.jobTitle ? ` — ${employee.jobTitle}` : ''}` : ''}
          </p>
        </div>
      </div>

      <div className="card p-4">
        <p className="text-sm text-gray-600 mb-3">
          اختر الحسابات/المحافظ التي يُسمح للموظف بالعمل عليها. عند Check-in في كل جلسة، يختار من هذه القائمة.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {accounts.map(acc => {
            const active = selected.has(acc.id)
            return (
              <label key={acc.id} className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${
                active
                  ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200'
                  : 'border-gray-200 hover:border-blue-200 hover:bg-blue-50/30'
              }`}>
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggle(acc.id)}
                  className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <Wallet size={14} className={active ? 'text-blue-600' : 'text-gray-400'} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{acc.name}</p>
                  <p className="text-[10px] text-gray-400">{acc.currency}</p>
                </div>
              </label>
            )
          })}
          {accounts.length === 0 && (
            <p className="text-gray-400 text-sm col-span-full text-center py-8">لا توجد حسابات معرّفة</p>
          )}
        </div>
      </div>

      {msg && (
        <div className={`text-sm px-4 py-2 rounded-lg ${msg.startsWith('خطأ') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {msg}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? 'جاري الحفظ...' : `حفظ (${selected.size})`}
        </button>
        <Link href="/employees" className="btn-secondary">إلغاء</Link>
      </div>
    </div>
  )
}
