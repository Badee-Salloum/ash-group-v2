'use client'
// Reconciliation-row trigger — opens the shared LinkSuggestionsModal. The
// modal itself owns the fetch + list + confirm flow; this component is just
// the ⚡ button plus a "closest-match" badge (time delta) sitting inline in
// the row so the operator can eyeball how likely a good match is before
// clicking through.

import { useState } from 'react'
import { Link2, Loader2 } from 'lucide-react'
import LinkSuggestionsModal from './LinkSuggestionsModal'

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

export default function SuggestMatchButton({ transactionId, onResolved, bestMatch }: Props) {
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState(false)

  const bestTimeLabel = bestMatch ? formatTimeDiff(bestMatch.timeDiffSeconds) : null
  const bestColor = bestMatch
    ? (bestMatch.confidence >= 80 ? 'text-emerald-600 bg-emerald-50'
      : bestMatch.confidence >= 50 ? 'text-amber-600 bg-amber-50'
      : 'text-gray-500 bg-gray-50')
    : ''

  function handleOpen() {
    // Brief visual flash so the button doesn't look inert while the modal
    // spins up its fetch. The modal itself renders a proper loading state
    // once mounted.
    setOpening(true)
    setOpen(true)
    setTimeout(() => setOpening(false), 250)
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <button
          onClick={handleOpen}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-amber-500 hover:text-amber-700 hover:bg-amber-50 transition-colors"
          title="اقتراح ربط"
          aria-label="اقتراح ربط"
        >
          {opening ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
        </button>
        {bestTimeLabel && (
          <span
            className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${bestColor}`}
            title={`أقرب مطابقة: فارق ${bestTimeLabel} — تطابق ${bestMatch!.confidence}%`}
          >
            {bestTimeLabel}
          </span>
        )}
      </div>

      <LinkSuggestionsModal
        transactionId={transactionId}
        open={open}
        onClose={() => setOpen(false)}
        onResolved={onResolved}
      />
    </>
  )
}
