'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import DataTable, { Column } from '@/components/tables/DataTable'
import { fmtSyria } from '@/lib/datetime'
import { User, Shield, AlertTriangle, TrendingUp } from 'lucide-react'

interface Account { id: string; name: string }

interface Customer extends Record<string, unknown> {
  name: string
  accountIds: string[]
  accountLabels: string[]
  currencies: string[]
  depositCount: number
  depositSum: Record<string, number>
  withdrawalCount: number
  withdrawalSum: Record<string, number>
  balance: Record<string, number>
  discrepancyCount: number
  matchedCount: number
  pendingCount: number
  totalOps: number
  trustScore: number
  firstSeen: string
  lastSeen: string
  lastOpType: string
  lastOpAmount: number
  lastOpCurrency: string
}

function trustStyle(score: number) {
  if (score >= 80) return { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'موثوق' }
  if (score >= 50) return { cls: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'متوسط' }
  return { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'منخفض' }
}

function fmtMulti(obj: Record<string, number>) {
  const keys = Object.keys(obj)
  if (keys.length === 0) return '—'
  return keys.map(k => `${Number(obj[k]).toLocaleString('en', { minimumFractionDigits: 2 })} ${k}`).join(' · ')
}

export default function CustomersPage() {
  const [data, setData] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [filters, setFilters] = useState({ accountId: '', currency: '', dateFrom: '', dateTo: '' })
  const [availableCurrencies, setAvailableCurrencies] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v))
    const r = await fetch(`/api/customers?${params}`)
    const d = await r.json()
    if (d.success) {
      setData(d.data || [])
      const curs = Array.from(new Set((d.data as Customer[]).flatMap(c => c.currencies))) as string[]
      setAvailableCurrencies(curs.sort())
    }
    setLoading(false)
  }, [filters])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/accounts').then(r => r.json()).then(d => {
      if (d.success) setAccounts(d.data.map((a: Account) => ({ id: a.id, name: a.name })))
    })
  }, [])

  function setFilter(k: keyof typeof filters, v: string) {
    setFilters(f => ({ ...f, [k]: v }))
  }

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: 'العميل',
      render: c => (
        <Link
          href={`/customers/${encodeURIComponent(c.name)}`}
          className="flex items-center gap-2 group"
        >
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-medium text-xs shrink-0">
            {c.name.charAt(0)}
          </div>
          <div>
            <p className="font-medium text-gray-900 group-hover:text-brand-600 transition-colors">{c.name}</p>
            <p className="text-[10px] text-gray-400">{c.accountLabels.join(' · ')}</p>
          </div>
        </Link>
      ),
    },
    {
      key: 'trustScore',
      header: 'موثوقية',
      render: c => {
        const s = trustStyle(c.trustScore)
        return (
          <span className={`badge ${s.cls} ring-1 font-bold`}>
            <Shield size={10} /> {c.trustScore}% {s.label}
          </span>
        )
      },
    },
    {
      key: 'totalOps',
      header: 'العمليات',
      render: c => (
        <div className="text-xs">
          <div className="font-semibold text-gray-700">{c.totalOps} إجمالي</div>
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <span className="text-emerald-600">↓{c.depositCount}</span>
            <span className="text-sky-600">↑{c.withdrawalCount}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'depositSum',
      header: 'إجمالي الإيداعات',
      sortAccessor: c => Object.values(c.depositSum || {}).reduce((s, v) => s + Number(v || 0), 0),
      render: c => <span className="font-mono text-xs text-emerald-700">{fmtMulti(c.depositSum)}</span>,
    },
    {
      key: 'withdrawalSum',
      header: 'إجمالي السحوبات',
      sortAccessor: c => Object.values(c.withdrawalSum || {}).reduce((s, v) => s + Number(v || 0), 0),
      render: c => <span className="font-mono text-xs text-sky-700">{fmtMulti(c.withdrawalSum)}</span>,
    },
    {
      key: 'balance',
      header: 'الرصيد (إيداع - سحب)',
      sortAccessor: c => Object.values(c.balance || {}).reduce((s, v) => s + Number(v || 0), 0),
      render: c => {
        const entries = Object.entries(c.balance)
        if (entries.length === 0) return '—'
        return (
          <div className="font-mono text-xs space-y-0.5">
            {entries.map(([cur, v]) => (
              <div key={cur} className={v >= 0 ? 'text-emerald-700 font-semibold' : 'text-rose-600 font-semibold'}>
                {Number(v).toLocaleString('en', { minimumFractionDigits: 2 })} {cur}
              </div>
            ))}
          </div>
        )
      },
    },
    {
      key: 'discrepancyCount',
      header: 'مشاكل',
      render: c => (
        c.discrepancyCount > 0
          ? <span className="badge bg-rose-50 text-rose-700 ring-1 ring-rose-200">
              <AlertTriangle size={10} /> {c.discrepancyCount} فارق
            </span>
          : <span className="text-gray-300 text-xs">—</span>
      ),
    },
    {
      key: 'lastSeen',
      header: 'آخر عملية',
      render: c => (
        <div className="text-xs">
          <div className="font-mono text-gray-600">{fmtSyria(c.lastSeen, false)}</div>
          <div className="text-[10px] text-gray-400">
            {c.lastOpType === 'DEPOSIT' ? '↓ إيداع' : '↑ سحب'} · {c.lastOpAmount.toFixed(2)} {c.lastOpCurrency}
          </div>
        </div>
      ),
    },
  ]

  const totalCustomers = data.length
  const trustedCount = data.filter(c => c.trustScore >= 80).length
  const problematicCount = data.filter(c => c.discrepancyCount > 0).length
  const totalOps = data.reduce((s, c) => s + c.totalOps, 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">العملاء</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Customers — تتبّع كامل لكل عميل وسجله مع الحسابات
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-gray-400 font-bold uppercase">إجمالي العملاء</p>
            <User size={14} className="text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-gray-800 font-mono">{totalCustomers}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-emerald-500 font-bold uppercase">موثوقون 80%+</p>
            <Shield size={14} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-700 font-mono">{trustedCount}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-rose-500 font-bold uppercase">لديهم مشاكل</p>
            <AlertTriangle size={14} className="text-rose-500" />
          </div>
          <p className="text-2xl font-bold text-rose-700 font-mono">{problematicCount}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-gray-400 font-bold uppercase">إجمالي العمليات</p>
            <TrendingUp size={14} className="text-gray-500" />
          </div>
          <p className="text-2xl font-bold text-gray-800 font-mono">{totalOps.toLocaleString('en')}</p>
        </div>
      </div>

      <div className="card p-3 sm:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          <select className="input text-sm" value={filters.accountId} onChange={e => setFilter('accountId', e.target.value)}>
            <option value="">كل الحسابات</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="input text-sm" value={filters.currency} onChange={e => setFilter('currency', e.target.value)}>
            <option value="">كل العملات</option>
            {availableCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="date" className="input text-sm" value={filters.dateFrom}
            onChange={e => setFilter('dateFrom', e.target.value)} />
          <input type="date" className="input text-sm" value={filters.dateTo}
            onChange={e => setFilter('dateTo', e.target.value)} />
        </div>
      </div>

      <DataTable
        data={data}
        columns={columns}
        loading={loading}
        exportFilename="customers"
        emptyMessage="لا يوجد عملاء في النطاق المحدد"
      />
    </div>
  )
}
