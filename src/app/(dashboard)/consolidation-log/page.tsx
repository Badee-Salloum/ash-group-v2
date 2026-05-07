'use client'
import { useEffect, useState, useCallback } from 'react'
import DataTable, { Column } from '@/components/tables/DataTable'
import { fmtSyria } from '@/lib/datetime'
import { Trash2 } from 'lucide-react'

interface ConsolidationEntry extends Record<string, unknown> {
  id: string
  createdAt: string
  user: { name: string; email: string } | null
  details: {
    accountId: string
    accountLabel: string
    accountName: string
    currency: string
    amount: number
    deposit: {
      id: string
      shamCashTxId: string | null
      txDateTime: string
      accountNumber: string
      notes: string
    }
    withdrawal: {
      id: string
      shamCashTxId: string | null
      txDateTime: string
      accountNumber: string
      notes: string
    }
  }
}

interface Account { id: string; name: string }

export default function ConsolidationLogPage() {
  const [data, setData] = useState<ConsolidationEntry[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ accountId: '', dateFrom: '', dateTo: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v))
    const r = await fetch(`/api/consolidation-log?${params}`)
    const d = await r.json()
    if (d.success) setData(d.data || [])
    setLoading(false)
  }, [filters])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/accounts').then(r => r.json()).then(d => {
      if (d.success) setAccounts(d.data.map((a: Account) => ({ id: a.id, name: a.name })))
    })
  }, [])

  async function deleteOne(id: string) {
    if (!confirm('هل أنت متأكد من حذف هذا السجل؟')) return
    try {
      const res = await fetch('/api/consolidation-log', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'فشل الحذف')
      load()
    } catch (e) {
      alert('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function deleteAllShown() {
    if (data.length === 0) return
    if (!confirm(`⚠️ سيتم حذف ${data.length} سجل من سجل الدمج. لا يمكن التراجع. هل أنت متأكد؟`)) return
    if (!confirm('تأكيد نهائي: حذف جميع السجلات المعروضة؟')) return
    try {
      const res = await fetch('/api/consolidation-log', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: data.map(d => d.id) }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'فشل الحذف')
      load()
    } catch (e) {
      alert('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const columns: Column<ConsolidationEntry>[] = [
    {
      key: 'createdAt',
      header: 'وقت الدمج',
      render: row => (
        <span className="text-xs font-mono text-gray-600">
          {fmtSyria(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'account',
      header: 'الحساب',
      render: row => row.details.accountLabel || '—',
    },
    {
      key: 'accountName',
      header: 'اسم الحساب (المقابل)',
      render: row => <span className="font-medium">{row.details.accountName}</span>,
    },
    {
      key: 'amount',
      header: 'المبلغ',
      render: row => (
        <span className="font-mono font-medium">
          {Number(row.details.amount).toLocaleString('en', { minimumFractionDigits: 2 })} {row.details.currency}
        </span>
      ),
    },
    {
      key: 'depositSC',
      header: 'رقم الإيداع (SC)',
      render: row => (
        <div className="text-xs">
          <div className="font-mono">{row.details.deposit.shamCashTxId || '—'}</div>
          <div className="text-gray-400">{fmtSyria(row.details.deposit.txDateTime, false)}</div>
        </div>
      ),
    },
    {
      key: 'withdrawalSC',
      header: 'رقم السحب (SC)',
      render: row => (
        <div className="text-xs">
          <div className="font-mono">{row.details.withdrawal.shamCashTxId || '—'}</div>
          <div className="text-gray-400">{fmtSyria(row.details.withdrawal.txDateTime, false)}</div>
        </div>
      ),
    },
    {
      key: 'depositAccNum',
      header: 'رقم حساب الإيداع',
      render: row => <span className="font-mono text-xs">{row.details.deposit.accountNumber || '—'}</span>,
    },
    {
      key: 'withdrawalAccNum',
      header: 'رقم حساب السحب',
      render: row => <span className="font-mono text-xs">{row.details.withdrawal.accountNumber || '—'}</span>,
    },
    {
      key: 'notes',
      header: 'ملاحظات',
      render: row => {
        const dep = row.details.deposit.notes || ''
        const wd = row.details.withdrawal.notes || ''
        if (!dep && !wd) return <span className="text-gray-400">—</span>
        return (
          <div className="text-xs text-gray-600 max-w-[260px] space-y-0.5">
            {dep && <div title={dep}><span className="text-emerald-600">↓</span> {dep.slice(0, 60)}</div>}
            {wd && <div title={wd}><span className="text-sky-600">↑</span> {wd.slice(0, 60)}</div>}
          </div>
        )
      },
    },
    {
      key: 'user',
      header: 'نُفّذ بواسطة',
      render: row => (
        <span className="text-xs text-gray-600">{row.user?.name || '—'}</span>
      ),
    },
    {
      key: 'actions',
      header: 'إجراء',
      sortable: false,
      render: row => (
        <button
          onClick={() => deleteOne(row.id)}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:text-red-700 hover:bg-red-50 transition-colors"
          title="حذف هذا السجل"
        >
          <Trash2 size={14} />
        </button>
      ),
    },
  ]

  function setFilter(k: keyof typeof filters, v: string) {
    setFilters(f => ({ ...f, [k]: v }))
  }

  const totalsByCur = data.reduce((acc: Record<string, number>, e) => {
    const cur = e.details.currency || 'USD'
    acc[cur] = (acc[cur] || 0) + Number(e.details.amount || 0)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">سجل الدمج التلقائي</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Consolidation Log — العمليات التي تم دمجها وحذفها تلقائياً كأزواج (إيداع+سحب)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.length > 0 && (
            <button
              onClick={deleteAllShown}
              className="btn-danger btn-sm"
              title="حذف جميع السجلات المعروضة (حسب الفلاتر الحالية)"
            >
              <Trash2 size={14} /> حذف المعروض ({data.length})
            </button>
          )}
        </div>
        {Object.keys(totalsByCur).length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(totalsByCur).map(([cur, total]) => (
              <div key={cur} className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-2">
                <p className="text-[10px] text-purple-600 font-bold uppercase tracking-wider">
                  مجموع الأزواج {cur}
                </p>
                <p className="text-lg font-mono font-bold text-purple-700">
                  {total.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {cur}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-3 sm:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <select className="input text-sm" value={filters.accountId} onChange={e => setFilter('accountId', e.target.value)}>
            <option value="">كل الحسابات</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input type="date" className="input text-sm" value={filters.dateFrom}
            onChange={e => setFilter('dateFrom', e.target.value)} placeholder="من تاريخ" />
          <input type="date" className="input text-sm" value={filters.dateTo}
            onChange={e => setFilter('dateTo', e.target.value)} placeholder="إلى تاريخ" />
        </div>
      </div>

      <DataTable
        data={data}
        columns={columns}
        loading={loading}
        exportFilename="consolidation-log"
        emptyMessage="لا توجد عمليات دمج تلقائي في الفترة المحددة"
      />
    </div>
  )
}
