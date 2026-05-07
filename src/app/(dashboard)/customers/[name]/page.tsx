'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import DataTable, { Column } from '@/components/tables/DataTable'
import { fmtSyria } from '@/lib/datetime'
import { ArrowRight, TrendingUp, TrendingDown, Shield, AlertTriangle, User, Fingerprint } from 'lucide-react'

interface TxRow extends Record<string, unknown> {
  id: string
  accountId: string
  accountLabel: string
  type: string
  status: string
  source: string
  amount: string
  currency: string
  txDateTime: string
  shamCashTxId: string | null
  platformTxId: string | null
  platformUserId: string | null
  amountDiff: string | null
  notes: string | null
  rawData: Record<string, unknown> | null
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  MATCHED:     { label: 'مطابقة',      cls: 'badge-matched' },
  PENDING_SC:  { label: 'شام كاش فقط', cls: 'badge-pending-sc' },
  PENDING_P:   { label: 'المنصة فقط',  cls: 'badge-pending-p' },
  DISCREPANCY: { label: 'فارق',        cls: 'badge-discrepancy' },
  WASTE:       { label: 'هدر',         cls: 'badge-waste' },
}

export default function CustomerDetailPage() {
  const params = useParams<{ name: string }>()
  const router = useRouter()
  const name = decodeURIComponent(params?.name || '')
  const [data, setData] = useState<TxRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/customers/${encodeURIComponent(name)}`)
    const d = await r.json()
    // If the server discovered a canonical name for this USER-<id> placeholder,
    // jump to the proper customer page so the URL + heading reflect it.
    if (d.success && d.redirectName && d.redirectName !== name) {
      router.replace(`/customers/${encodeURIComponent(d.redirectName)}`)
      return
    }
    if (d.success) setData(d.data || [])
    setLoading(false)
  }, [name, router])

  useEffect(() => { load() }, [load])

  // Aggregate stats
  const depositTotal: Record<string, number> = {}
  const withdrawalTotal: Record<string, number> = {}
  let depCount = 0, wdCount = 0, discCount = 0, matchCount = 0
  for (const t of data) {
    const amt = Number(t.amount)
    if (t.type === 'DEPOSIT') {
      depCount++
      depositTotal[t.currency] = (depositTotal[t.currency] || 0) + amt
    } else {
      wdCount++
      withdrawalTotal[t.currency] = (withdrawalTotal[t.currency] || 0) + amt
    }
    if (t.status === 'DISCREPANCY') discCount++
    if (t.status === 'MATCHED') matchCount++
  }
  const balance: Record<string, number> = {}
  const currencies = Array.from(new Set([...Object.keys(depositTotal), ...Object.keys(withdrawalTotal)]))
  for (const cur of currencies) {
    balance[cur] = (depositTotal[cur] || 0) - (withdrawalTotal[cur] || 0)
  }

  // Collect distinct platform USER IDs for this customer
  const platformUserIds = Array.from(
    new Set(data.map(t => t.platformUserId).filter((x): x is string => !!x && x !== '—'))
  )
  const totalOps = depCount + wdCount
  const trustScore = totalOps > 0
    ? Math.max(0, Math.round((matchCount / totalOps) * 100 - (discCount / totalOps) * 20))
    : 0

  const columns: Column<TxRow>[] = [
    {
      key: 'txDateTime',
      header: 'التاريخ',
      render: r => (
        <span className="text-xs font-mono text-gray-600">
          {fmtSyria(r.txDateTime)}
        </span>
      ),
    },
    {
      key: 'accountLabel',
      header: 'الحساب',
      render: r => <span className="text-sm">{r.accountLabel || '—'}</span>,
    },
    {
      key: 'type',
      header: 'النوع',
      render: r => r.type === 'DEPOSIT' ? '↓ إيداع' : '↑ سحب',
    },
    {
      key: 'status',
      header: 'الحالة',
      render: r => {
        const s = STATUS_LABELS[r.status] || { label: r.status, cls: 'badge-waste' }
        return <span className={`badge ${s.cls}`}>{s.label}</span>
      },
    },
    {
      key: 'amount',
      header: 'المبلغ',
      render: r => (
        <span className="font-mono font-medium">
          {Number(r.amount).toLocaleString('en', { minimumFractionDigits: 2 })} {r.currency}
        </span>
      ),
    },
    {
      key: 'amountDiff',
      header: 'الفارق',
      render: r => r.amountDiff
        ? <span className="text-red-600 font-mono text-sm font-bold">
            {Number(r.amountDiff).toLocaleString('en', { minimumFractionDigits: 2 })}
          </span>
        : '—',
    },
    {
      key: 'shamCashTxId',
      header: 'رقم شام كاش',
      render: r => <span className="font-mono text-xs">{r.shamCashTxId || '—'}</span>,
    },
    {
      key: 'platformTxId',
      header: 'رقم المنصة',
      render: r => <span className="font-mono text-xs">{r.platformTxId || '—'}</span>,
    },
    {
      key: 'platformUserId',
      header: 'USER ID',
      render: r => r.platformUserId
        ? <span className="font-mono text-xs text-blue-700">{r.platformUserId}</span>
        : <span className="text-gray-400">—</span>,
    },
    {
      key: 'notes',
      header: 'ملاحظات',
      render: r => {
        const raw = r.rawData as Record<string, unknown> | null
        const txt = r.notes || String(raw?.notes || '') || ''
        return txt ? <span className="text-xs text-gray-500">{txt.slice(0, 50)}</span> : '—'
      },
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/customers" className="btn-secondary btn-sm">
          <ArrowRight size={14} /> العملاء
        </Link>
      </div>

      {/* Customer header */}
      <div className="card p-5">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white text-xl font-bold flex items-center justify-center shrink-0">
            {name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900">{name}</h1>
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
              <User size={12} /> {totalOps} عملية إجمالاً
            </p>
            {platformUserIds.length > 0 && (
              <div className="mt-2 flex items-start gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400 mt-1">
                  <Fingerprint size={11} /> USER ID:
                </span>
                {platformUserIds.map(uid => (
                  <span
                    key={uid}
                    className="badge bg-blue-50 text-blue-700 ring-1 ring-blue-200 font-mono text-[11px]"
                    title="USER ID الخاص بالمنصة"
                  >
                    {uid}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            {(() => {
              const cs = trustScore >= 80
                ? { cls: 'text-emerald-700 bg-emerald-50 ring-emerald-200', label: 'موثوق' }
                : trustScore >= 50
                ? { cls: 'text-amber-700 bg-amber-50 ring-amber-200', label: 'متوسط' }
                : { cls: 'text-red-700 bg-red-50 ring-red-200', label: 'منخفض' }
              return (
                <div className={`rounded-xl px-4 py-3 ring-1 ${cs.cls}`}>
                  <div className="flex items-center gap-2">
                    <Shield size={14} />
                    <span className="font-bold text-sm">{cs.label}</span>
                  </div>
                  <p className="text-2xl font-extrabold font-mono mt-0.5">{trustScore}%</p>
                  <p className="text-[10px] font-bold uppercase">موثوقية</p>
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Summary grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-emerald-500 font-bold uppercase">الإيداعات</p>
            <TrendingUp size={14} className="text-emerald-500" />
          </div>
          <p className="text-lg font-bold text-emerald-700 font-mono">
            {Object.entries(depositTotal).map(([c, v]) => (
              <span key={c} className="block text-sm">
                {v.toLocaleString('en', { minimumFractionDigits: 2 })} {c}
              </span>
            ))}
            {Object.keys(depositTotal).length === 0 && <span className="text-gray-400">—</span>}
          </p>
          <p className="text-[10px] text-gray-400 mt-1">{depCount} عملية</p>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-sky-500 font-bold uppercase">السحوبات</p>
            <TrendingDown size={14} className="text-sky-500" />
          </div>
          <p className="text-lg font-bold text-sky-700 font-mono">
            {Object.entries(withdrawalTotal).map(([c, v]) => (
              <span key={c} className="block text-sm">
                {v.toLocaleString('en', { minimumFractionDigits: 2 })} {c}
              </span>
            ))}
            {Object.keys(withdrawalTotal).length === 0 && <span className="text-gray-400">—</span>}
          </p>
          <p className="text-[10px] text-gray-400 mt-1">{wdCount} عملية</p>
        </div>

        <div className="card p-4">
          <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">الرصيد</p>
          <div className="text-lg font-bold font-mono">
            {Object.entries(balance).map(([c, v]) => (
              <span key={c} className={`block text-sm ${v >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                {v.toLocaleString('en', { minimumFractionDigits: 2 })} {c}
              </span>
            ))}
            {Object.keys(balance).length === 0 && <span className="text-gray-400">—</span>}
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-rose-500 font-bold uppercase">مشاكل</p>
            <AlertTriangle size={14} className="text-rose-500" />
          </div>
          <p className="text-2xl font-bold text-rose-700 font-mono">{discCount}</p>
          <p className="text-[10px] text-gray-400 mt-1">عملية بفارق</p>
        </div>
      </div>

      <DataTable
        data={data}
        columns={columns}
        loading={loading}
        exportFilename={`customer-${name}`}
        emptyMessage="لا توجد عمليات لهذا العميل"
      />
    </div>
  )
}
