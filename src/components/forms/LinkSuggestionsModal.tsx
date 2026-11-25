'use client'
// Shared modal for "ربط مع عملية أخرى" — used by both the /reconciliation
// row-actions (SuggestMatchButton) and the customer-detail row-actions menu
// (TransactionRowActions). Fetches ranked candidates from suggest-match and
// confirms the pick against confirm-link. A collapsed manual-cuid fallback
// covers rare cases where the wanted match is outside the ±24h/currency
// window that suggest-match filters on.

import { useState, useEffect, useCallback } from 'react'
import {
  Link2, CheckCircle, Loader2, Zap, ArrowLeftRight, Clock, User, Save,
} from 'lucide-react'
import { fmtSyria } from '@/lib/datetime'
import { Modal } from '@/components/ui/Modal'

interface Suggestion {
  matchId: string
  matchSource: string
  matchAmount: number
  matchCurrency: string
  matchDateTime: string
  shamCashTxId: string | null
  platformTxId: string | null
  platformUserId: string | null
  amountDiff: number
  timeDiffSeconds: number
  confidence: number
  customerName: string | null
}

interface SourceInfo {
  id: string
  source: string
  type: string
  amount: number
  currency: string
  txDateTime: string
  shamCashTxId: string | null
  platformTxId: string | null
  accountName: string
}

interface Props {
  transactionId: string
  open: boolean
  onClose: () => void
  onResolved: () => void
}

function formatTimeDiff(seconds: number) {
  if (seconds < 60) return `${seconds}ث`
  if (seconds < 3600) return `${Math.round(seconds / 60)}د`
  return `${(seconds / 3600).toFixed(1)}س`
}

function confidenceStyle(c: number) {
  if (c >= 80) return { ring: 'ring-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', bar: 'bg-emerald-500', label: 'عالي جداً' }
  if (c >= 60) return { ring: 'ring-green-500', text: 'text-green-600', bg: 'bg-green-50', bar: 'bg-green-500', label: 'عالي' }
  if (c >= 40) return { ring: 'ring-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', bar: 'bg-amber-500', label: 'متوسط' }
  return { ring: 'ring-gray-400', text: 'text-gray-500', bg: 'bg-gray-50', bar: 'bg-gray-400', label: 'منخفض' }
}

export default function LinkSuggestionsModal({
  transactionId, open, onClose, onResolved,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [sourceInfo, setSourceInfo] = useState<SourceInfo | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [manualId, setManualId] = useState('')

  const loadSuggestions = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/reconciliation/suggest-match?transactionId=${transactionId}`)
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'تعذّر جلب الاقتراحات')
      setSuggestions(d.suggestions || [])
      setSourceInfo(d.source || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [transactionId])

  useEffect(() => {
    if (!open) return
    // Reset state each time we open — a stale success flag from a previous
    // open would prevent the list from ever rendering again.
    setSuccess(false); setSuggestions([]); setSourceInfo(null); setManualId('')
    loadSuggestions()
  }, [open, loadSuggestions])

  async function confirmLink(matchId: string) {
    if (!matchId.trim()) { setError('معرّف العملية مطلوب'); return }
    setConfirming(matchId); setError('')
    try {
      const res = await fetch('/api/reconciliation/confirm-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, matchId: matchId.trim() }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'تعذّر الربط')
      setSuccess(true)
      setTimeout(() => {
        onResolved()
        onClose()
      }, 1000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setConfirming(null)
    }
  }

  // Source summary rendered inline into the modal subtitle — always visible in
  // the sticky header, saves ~60px of vertical body space vs the old amber card.
  const sourceSummary = sourceInfo ? (
    <span className="inline-flex items-center gap-1.5 flex-wrap text-[11px]">
      <span className="text-gray-500">ربط من:</span>
      <span className="badge bg-amber-100 text-amber-700 font-bold text-[10px]">
        {sourceInfo.source === 'SHAM_CASH' ? 'شام كاش' : 'المنصة'}
      </span>
      <span className="badge bg-gray-100 text-gray-700 text-[10px]">
        {sourceInfo.type === 'DEPOSIT' ? 'إيداع' : 'سحب'}
      </span>
      <span className="font-mono font-bold text-gray-800">
        {sourceInfo.amount.toLocaleString('en', { minimumFractionDigits: 2 })} {sourceInfo.currency}
      </span>
      <span className="text-gray-500 inline-flex items-center gap-1">
        <Clock size={10} />
        {fmtSyria(sourceInfo.txDateTime)}
      </span>
      {sourceInfo.accountName && (
        <span className="text-gray-600 inline-flex items-center gap-1 truncate max-w-[220px]">
          <User size={10} />
          {sourceInfo.accountName}
        </span>
      )}
    </span>
  ) : (
    <span className="text-gray-500 text-[11px]">اختر العملية المقابلة لتأكيد الربط.</span>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      panelClassName="!max-w-4xl"
      title={
        <span className="inline-flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-amber-100 text-amber-600 inline-flex items-center justify-center">
            <Zap size={14} />
          </span>
          اقتراحات الربط
        </span>
      }
      subtitle={sourceSummary}
      footer={
        <div className="flex-1 flex items-center justify-between gap-3 text-xs text-gray-500">
          <span>
            {suggestions.length > 0
              ? `${suggestions.length} اقتراح — مرتّبة حسب نسبة التطابق`
              : loading ? 'جاري البحث…' : 'لا توجد اقتراحات'}
          </span>
          <span className="hidden sm:flex items-center gap-2 text-[10px]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> عالي</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> متوسط</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400" /> منخفض</span>
          </span>
        </div>
      }
    >
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3 rounded-lg mb-3 flex items-center gap-2">
          <CheckCircle size={16} /> تم الربط بنجاح.
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-2 rounded-lg mb-3">
          {error}
        </div>
      )}

      {/* Suggestions list */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">
          <Loader2 size={28} className="mx-auto animate-spin" />
          <p className="text-xs mt-2">جاري البحث عن مرشّحين خلال ±24 ساعة…</p>
        </div>
      ) : suggestions.length === 0 && !success ? (
        <div className="text-center py-10 text-gray-400">
          <Link2 size={32} className="mx-auto mb-2 opacity-40" />
          <p className="font-medium text-gray-500">لا توجد اقتراحات ضمن ±24 ساعة</p>
          <p className="text-xs mt-1">استخدم الإدخال اليدوي أدناه إن كنت تعرف معرّف العملية.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {suggestions.map(s => {
            const cs = confidenceStyle(s.confidence)
            const accountName = s.customerName || ''
            const exactAmount = s.amountDiff < 0.01
            const isConfirming = confirming === s.matchId

            return (
              <div
                key={s.matchId}
                className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-amber-300 hover:shadow-md transition-all"
              >
                {/* Confidence bar at top */}
                <div className="h-1 bg-gray-100">
                  <div className={`h-full ${cs.bar} transition-all`} style={{ width: `${s.confidence}%` }} />
                </div>

                <div className="p-3 flex items-center gap-3 flex-wrap md:flex-nowrap">
                  {/* Confidence ring */}
                  <div className={`relative w-14 h-14 rounded-full ${cs.bg} flex items-center justify-center ring-2 ${cs.ring} ring-offset-2 shrink-0`}>
                    <div className="text-center">
                      <div className={`text-sm font-extrabold font-mono leading-none ${cs.text}`}>{s.confidence}%</div>
                      <div className={`text-[8px] font-bold ${cs.text} leading-none mt-0.5`}>{cs.label}</div>
                    </div>
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    {/* IDs — prominent, top of the card */}
                    {(s.shamCashTxId || s.platformTxId || s.platformUserId) && (
                      <div dir="ltr" className="flex items-center gap-x-4 gap-y-1 flex-wrap">
                        {s.shamCashTxId && (
                          <span className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-gray-400">SC</span>
                            <span className="font-mono text-sm font-bold text-gray-800">{s.shamCashTxId}</span>
                          </span>
                        )}
                        {s.platformTxId && (
                          <span className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-gray-400">P</span>
                            <span className="font-mono text-sm font-bold text-gray-800">{s.platformTxId}</span>
                          </span>
                        )}
                        {s.platformUserId && (
                          <span className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-gray-400">UID</span>
                            <span className="font-mono text-sm font-bold text-gray-800">{s.platformUserId}</span>
                          </span>
                        )}
                      </div>
                    )}
                    {/* Row 1: amount + status badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-gray-900 text-base">
                        {s.matchAmount.toLocaleString('en', { minimumFractionDigits: 2 })} {s.matchCurrency}
                      </span>
                      {exactAmount ? (
                        <span className="badge bg-emerald-50 text-emerald-700 text-[10px] font-bold ring-1 ring-emerald-200">
                          <CheckCircle size={10} /> مبلغ مطابق
                        </span>
                      ) : (
                        <span
                          className="badge bg-rose-50 text-rose-700 text-[10px] font-bold ring-1 ring-rose-200"
                          title={sourceInfo ? `المصدر: ${sourceInfo.amount.toFixed(2)} | المقابل: ${s.matchAmount.toFixed(2)}` : undefined}
                        >
                          <ArrowLeftRight size={10} /> فارق {s.amountDiff.toFixed(2)}
                        </span>
                      )}
                      <span className="badge bg-gray-100 text-gray-600 text-[10px]">
                        {s.matchSource === 'SHAM_CASH' ? 'شام كاش' : 'المنصة'}
                      </span>
                    </div>

                    {/* Row 2: meta (time + account) */}
                    <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500">
                      <span className="flex items-center gap-1 font-mono">
                        <Clock size={11} className="text-gray-400" />
                        {fmtSyria(s.matchDateTime).slice(5)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-gray-600 bg-gray-50 px-1.5 py-0.5 rounded">
                        فارق الوقت: <strong className="font-mono">{formatTimeDiff(s.timeDiffSeconds)}</strong>
                      </span>
                      {accountName && (
                        <span className="flex items-center gap-1 truncate max-w-[250px]">
                          <User size={11} className="text-gray-400" />
                          {accountName}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Confirm button */}
                  <button
                    onClick={() => confirmLink(s.matchId)}
                    disabled={confirming !== null || success}
                    className="btn-primary btn-sm shrink-0 min-w-[110px] justify-center"
                  >
                    {isConfirming ? (
                      <><Loader2 size={14} className="animate-spin" /> جاري…</>
                    ) : (
                      <><CheckCircle size={14} /> تأكيد الربط</>
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Manual cuid fallback — for matches outside the ±24h / currency window */}
      {!success && (
        <details className="mt-5 group">
          <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700 select-none inline-flex items-center gap-1">
            <span className="group-open:hidden">▸</span>
            <span className="hidden group-open:inline">▾</span>
            أدخل معرّف العملية يدوياً (للحالات خارج نافذة ±24 ساعة أو عملة مختلفة)
          </summary>
          <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
            <p className="text-[11px] text-gray-500 leading-relaxed">
              يجب أن تكون العملية النظيرة من نفس الحساب، نفس النوع (إيداع/سحب)، ومن مصدر مختلف (شام كاش / المنصة).
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={manualId}
                onChange={e => setManualId(e.target.value)}
                placeholder="cuid…"
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <button
                type="button"
                onClick={() => confirmLink(manualId)}
                disabled={!manualId.trim() || confirming !== null || success}
                className="btn-primary btn-sm shrink-0"
              >
                {confirming === manualId.trim() ? (
                  <><Loader2 size={14} className="animate-spin" /> جاري…</>
                ) : (
                  <><Save size={14} /> ربط</>
                )}
              </button>
            </div>
          </div>
        </details>
      )}
    </Modal>
  )
}
