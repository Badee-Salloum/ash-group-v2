'use client'
import { useState } from 'react'
import { Link2, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

interface Props {
  depositTxId: string
  depositAmount: number
  currency: string
  onResolved: () => void
}

export default function ManualDepositLink({ depositTxId, depositAmount, currency, onResolved }: Props) {
  const [shamCashTxId, setShamCashTxId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleLink() {
    if (!shamCashTxId.trim()) return
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/reconciliation/resolve-deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depositTxId, shamCashTxId: shamCashTxId.trim() }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setSuccess(true)
      setTimeout(onResolved, 1200)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  if (success) return (
    <span className="flex items-center gap-1 text-green-600 text-sm">
      <CheckCircle size={14} /> تم الربط
    </span>
  )

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          className="input text-xs py-1 w-40 font-mono"
          placeholder="رقم عملية شام كاش"
          value={shamCashTxId}
          onChange={e => setShamCashTxId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLink()}
        />
        <button
          onClick={handleLink}
          disabled={loading || !shamCashTxId.trim()}
          className="btn-primary btn-sm"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
          ربط
        </button>
      </div>
      {error && (
        <span className="flex items-center gap-1 text-red-600 text-xs">
          <AlertCircle size={12} /> {error}
        </span>
      )}
      <p className="text-xs text-gray-400">
        المنصة: {depositAmount.toLocaleString('en', { minimumFractionDigits: 2 })} {currency}
      </p>
    </div>
  )
}
