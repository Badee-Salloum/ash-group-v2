'use client'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link2, CheckCircle, Loader2, X, Zap, ArrowLeftRight, Clock, User, Hash } from 'lucide-react'
import { fmtSyria } from '@/lib/datetime'

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
  rawData: Record<string, unknown> | null
}

interface Props {
  transactionId: string
  onResolved: () => void
  bestMatch?: { timeDiffSeconds: number; amountDiff: number; confidence: number } | null
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

export default function SuggestMatchButton({ transactionId, onResolved, bestMatch }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [sourceInfo, setSourceInfo] = useState<Record<string, unknown> | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  // Lock body scroll while modal is open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  async function handleOpen() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/reconciliation/suggest-match?transactionId=${transactionId}`)
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setSuggestions(d.suggestions)
      setSourceInfo(d.source)
      setOpen(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm(matchId: string) {
    setConfirming(matchId)
    setError('')
    try {
      const res = await fetch('/api/reconciliation/confirm-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, matchId }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setSuccess(true)
      setTimeout(() => {
        setOpen(false)
        setSuccess(false)
        onResolved()
      }, 1200)
    } catch (e) {
      setError(String(e))
    } finally {
      setConfirming(null)
    }
  }

  if (success) return (
    <span className="flex items-center gap-1 text-green-600 text-sm">
      <CheckCircle size={14} /> تم الربط
    </span>
  )

  const bestTimeLabel = bestMatch ? formatTimeDiff(bestMatch.timeDiffSeconds) : null
  const bestColor = bestMatch
    ? (bestMatch.confidence >= 80 ? 'text-emerald-600 bg-emerald-50' : bestMatch.confidence >= 50 ? 'text-amber-600 bg-amber-50' : 'text-gray-500 bg-gray-50')
    : ''

  return (
    <>
      <div className="flex items-center gap-1">
        <button
          onClick={handleOpen}
          disabled={loading}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-amber-500 hover:text-amber-700 hover:bg-amber-50 transition-colors"
          title="اقتراح ربط"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
        </button>
        {bestTimeLabel && (
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${bestColor}`} title={`أقرب مطابقة: فارق ${bestTimeLabel} — تطابق ${bestMatch!.confidence}%`}>
            {bestTimeLabel}
          </span>
        )}
      </div>

      {error && !open && <span className="text-red-500 text-xs">{error}</span>}

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col animate-fade-in overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header with source op */}
            <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-l from-amber-50/50 to-white">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                      <Zap size={16} className="text-amber-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-800 text-base leading-tight">اقتراحات الربط</h3>
                      <p className="text-[11px] text-gray-400">اختر العملية المقابلة لتأكيد الربط</p>
                    </div>
                  </div>

                  {sourceInfo && (
                    <div className="bg-white/80 backdrop-blur-sm border border-amber-200/60 rounded-xl px-3 py-2">
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <span className="badge bg-amber-100 text-amber-700 font-bold">
                          {(sourceInfo.source as string) === 'SHAM_CASH' ? 'شام كاش' : 'المنصة'}
                        </span>
                        <span className="badge bg-gray-100 text-gray-700">
                          {(sourceInfo.type as string) === 'DEPOSIT' ? 'إيداع' : 'سحب'}
                        </span>
                        <span className="font-mono font-bold text-gray-800">
                          {Number(sourceInfo.amount).toLocaleString('en', { minimumFractionDigits: 2 })} {sourceInfo.currency as string}
                        </span>
                        <span className="text-gray-500 flex items-center gap-1">
                          <Clock size={11} />
                          {fmtSyria(sourceInfo.txDateTime as string)}
                        </span>
                        {sourceInfo.accountName ? (
                          <span className="text-gray-600 flex items-center gap-1 truncate">
                            <User size={11} />
                            {String(sourceInfo.accountName)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>

                <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 shrink-0">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="overflow-auto flex-1 px-4 py-4 bg-gray-50/50">
              {error && (
                <div className="bg-red-50 text-red-600 text-sm px-4 py-2 rounded-lg mb-3 border border-red-200">{error}</div>
              )}

              {suggestions.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <Link2 size={36} className="mx-auto mb-3 opacity-30" />
                  <p className="font-medium text-gray-500">لا توجد اقتراحات</p>
                  <p className="text-xs mt-1">لم يتم العثور على عمليات مطابقة محتملة خلال 24 ساعة</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {suggestions.map(s => {
                    const cs = confidenceStyle(s.confidence)
                    const raw = s.rawData as Record<string, unknown> | null
                    const sc = raw?.sc as Record<string, unknown> | undefined
                    const accountName = (raw?.accountName as string) || (sc?.accountName as string) || ''
                    const srcAmount = sourceInfo ? Number(sourceInfo.amount) : s.matchAmount
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
                                <span className="badge bg-rose-50 text-rose-700 text-[10px] font-bold ring-1 ring-rose-200" title={`المصدر: ${srcAmount.toFixed(2)} | المقابل: ${s.matchAmount.toFixed(2)}`}>
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

                            {/* Row 3: IDs (compact) */}
                            {(s.shamCashTxId || s.platformTxId || s.platformUserId) && (
                              <div className="flex items-center gap-3 flex-wrap text-[10px] text-gray-400">
                                {s.shamCashTxId && (
                                  <span className="flex items-center gap-1"><Hash size={9} /> SC <span className="font-mono text-gray-600">{s.shamCashTxId}</span></span>
                                )}
                                {s.platformTxId && (
                                  <span className="flex items-center gap-1"><Hash size={9} /> P <span className="font-mono text-gray-600">{s.platformTxId}</span></span>
                                )}
                                {s.platformUserId && (
                                  <span className="flex items-center gap-1"><User size={9} /> UID <span className="font-mono text-gray-600">{s.platformUserId}</span></span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Confirm button */}
                          <button
                            onClick={() => handleConfirm(s.matchId)}
                            disabled={confirming !== null}
                            className="btn-primary btn-sm shrink-0 min-w-[110px] justify-center"
                          >
                            {isConfirming ? (
                              <><Loader2 size={14} className="animate-spin" /> جاري...</>
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
            </div>

            {/* Footer */}
            <div className="px-6 py-2.5 border-t border-gray-100 bg-white text-xs text-gray-500 flex items-center justify-between">
              <span>
                {suggestions.length > 0
                  ? `${suggestions.length} اقتراح — مرتّبة حسب نسبة التطابق`
                  : 'لا توجد اقتراحات'}
              </span>
              <span className="flex items-center gap-2 text-[10px]">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> عالي</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> متوسط</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400" /> منخفض</span>
              </span>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
