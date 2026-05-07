'use client'
import Link from 'next/link'
import { Pencil, ExternalLink } from 'lucide-react'
import { Column } from '@/components/tables/DataTable'
import { fmtSyria } from '@/lib/datetime'
import ManualWithdrawalLink from '@/components/forms/ManualWithdrawalLink'
import ManualDepositLink from '@/components/forms/ManualDepositLink'
import SuggestMatchButton from '@/components/forms/SuggestMatchButton'
import {
  Transaction, TxStatus, TxType, ReviewCat,
  REVIEW_LABELS, REVIEW_COLORS, STATUS_LABELS, TYPE_LABELS,
  MatchInfoMap,
} from './types'

export function buildColumns({
  data,
  restricted,
  matchInfo,
  setEditTx,
  reload,
}: {
  data: Transaction[]
  restricted: boolean
  matchInfo: MatchInfoMap
  setEditTx: (t: Transaction) => void
  reload: () => void
}): Column<Record<string, unknown>>[] {
  const columns: Column<Record<string, unknown>>[] = [
    {
      key: '__index',
      header: '#',
      sortable: false,
      render: row => {
        const i = data.findIndex(t => t.id === row.id)
        return <span className="text-[11px] font-mono text-gray-400">{i >= 0 ? i + 1 : '—'}</span>
      },
    },
    {
      key: 'txDateTime',
      header: 'التاريخ والوقت',
      render: row => (
        <span className="text-xs text-gray-600 font-mono">
          {fmtSyria(row.txDateTime as string)}
        </span>
      ),
    },
    { key: 'account', header: 'الحساب', render: row => (row.account as { name: string }).name },
    {
      key: 'type',
      header: 'النوع',
      render: row => <span className="text-sm">{TYPE_LABELS[row.type as TxType]}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      render: row => {
        const s = STATUS_LABELS[row.status as TxStatus]
        return <span className={`badge ${s.cls}`}>{s.label}</span>
      },
    },
    {
      key: 'reviewCategory',
      header: 'المراجعة',
      render: row => {
        const cat = row.reviewCategory as ReviewCat | null
        const status = row.status as TxStatus
        const notes = (row.reviewNotes as string | null) || ''
        const reviewedAt = row.reviewedAt as string | null
        if (cat) {
          const tipParts = [REVIEW_LABELS[cat]]
          if (notes) tipParts.push(notes)
          if (reviewedAt) tipParts.push(`في ${fmtSyria(reviewedAt, false)}`)
          return (
            <span
              className={`badge ring-1 ${REVIEW_COLORS[cat]}`}
              title={tipParts.join('\n')}
            >
              {REVIEW_LABELS[cat]}
            </span>
          )
        }
        // Non-reviewed: show "مراجعة" button only for non-matched rows
        if (status === 'MATCHED') return <span className="text-gray-300">—</span>
        return (
          <button
            onClick={() => setEditTx(row as unknown as Transaction)}
            className="text-[11px] text-amber-700 bg-amber-50 hover:bg-amber-100 ring-1 ring-amber-200 px-2 py-0.5 rounded-md transition-colors"
            title="افتح نافذة التعديل لتسجيل نتيجة المراجعة"
          >
            مراجعة
          </button>
        )
      },
    },
    {
      key: 'accountName',
      header: 'اسم الحساب',
      render: row => {
        const raw = row.rawData as Record<string, unknown> | null
        const sc = raw?.sc as Record<string, unknown> | undefined
        const matchedRaw = (row.matchedTx as Record<string, unknown> | null)?.rawData as Record<string, unknown> | null
        const name = (raw?.accountName as string) || (sc?.accountName as string) || (matchedRaw?.accountName as string) || ''
        if (!name) return <span className="text-gray-400">—</span>
        return (
          <Link
            href={`/customers/${encodeURIComponent(name)}`}
            className="inline-flex items-center gap-1 text-sm text-gray-700 hover:text-brand-600 hover:underline group"
            title="فتح صفحة العميل"
          >
            <span>{name}</span>
            <ExternalLink size={11} className="opacity-0 group-hover:opacity-100 transition-opacity text-brand-500" />
          </Link>
        )
      },
    },
    {
      key: 'shamCashTxId',
      header: 'رقم شام كاش',
      render: row => {
        const matchedTx = row.matchedTx as Record<string, unknown> | null
        return (row.shamCashTxId as string) || (matchedTx?.shamCashTxId as string) || '—'
      },
    },
    {
      key: 'platformTxId',
      header: 'رقم المنصة',
      render: row => {
        const matchedTx = row.matchedTx as Record<string, unknown> | null
        return (row.platformTxId as string) || (matchedTx?.platformTxId as string) || '—'
      },
    },
    {
      key: 'platformUserId',
      header: 'User ID',
      render: row => {
        const matchedTx = row.matchedTx as Record<string, unknown> | null
        const uid = (row.platformUserId as string) || (matchedTx?.platformUserId as string) || ''
        if (!uid) return <span className="text-gray-400">—</span>
        return (
          <Link
            href={`/customers/by-user/${encodeURIComponent(uid)}`}
            className="inline-flex items-center gap-1 font-mono text-xs text-blue-700 hover:text-blue-900 hover:underline group"
            title="فتح صفحة العميل (عبر USER ID)"
          >
            <span>{uid}</span>
            <ExternalLink size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
          </Link>
        )
      },
    },
    ...(!restricted ? [{
      key: 'amount',
      header: 'المبلغ',
      render: (row: Record<string, unknown>) => {
        const status = row.status as TxStatus
        const currency = row.currency as string
        const amount = Number(row.amount)
        // For DISCREPANCY, show both SC and Platform amounts from rawData
        if (status === 'DISCREPANCY') {
          const raw = row.rawData as Record<string, unknown> | null
          const scRaw = raw?.sc as Record<string, unknown> | undefined
          const pRaw = raw?.platform as Record<string, unknown> | undefined
          let scAmount: number | null = null
          let pAmount: number | null = null
          if (scRaw && pRaw) {
            scAmount = Number((scRaw.receivedAmount as number) || (scRaw.sentAmount as number) || 0)
            pAmount = Number(pRaw.amount as number)
          }
          if (scAmount !== null && pAmount !== null) {
            return (
              <div className="flex flex-col gap-0.5 text-xs font-mono">
                <div className="flex items-center gap-1">
                  <span className="text-amber-600 text-[10px] font-bold">SC:</span>
                  <span>{scAmount.toLocaleString('en', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-blue-600 text-[10px] font-bold">P:</span>
                  <span>{pAmount.toLocaleString('en', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            )
          }
        }
        return (
          <span className="font-mono font-medium">
            {amount.toLocaleString('en', { minimumFractionDigits: 2 })} {currency}
          </span>
        )
      },
    },
    {
      key: 'amountDiff',
      header: 'الفارق',
      render: (row: Record<string, unknown>) => row.amountDiff
        ? <span className="text-red-600 font-mono text-sm font-bold">
            {Number(row.amountDiff).toLocaleString('en', { minimumFractionDigits: 2 })}
          </span>
        : '—',
    }] : []),
    { key: 'source', header: 'المصدر', render: row => row.source === 'SHAM_CASH' ? 'شام كاش' : 'المنصة' },
    {
      key: 'notes',
      header: 'ملاحظات',
      render: row => {
        const raw = row.rawData as Record<string, unknown> | null
        const scInner = raw?.sc as Record<string, unknown> | undefined
        const pInner = raw?.platform as Record<string, unknown> | undefined
        const matchedRaw = (row.matchedTx as Record<string, unknown> | null)?.rawData as Record<string, unknown> | null
        const txt = (row.notes as string | null)
          || String(raw?.notes || '')
          || String(scInner?.notes || '')
          || String(pInner?.notes || '')
          || String(matchedRaw?.notes || '')
        if (!txt) return <span className="text-gray-400">—</span>
        return (
          <span className="text-xs text-gray-600 line-clamp-2 max-w-[240px]" title={txt}>
            {txt}
          </span>
        )
      },
    },
    ...(!restricted ? [{
      key: 'actions',
      header: 'إجراء',
      sortable: false,
      render: (row: Record<string, unknown>) => {
        const status = row.status as TxStatus
        const type = row.type as TxType

        return (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setEditTx(row as unknown as Transaction)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
              title="تعديل"
            >
              <Pencil size={13} />
            </button>
            {status === 'DISCREPANCY' && type === 'WITHDRAWAL' && (
              <ManualWithdrawalLink
                platformTxId={row.id as string}
                platformAmount={Number(row.amount)}
                currency={row.currency as string}
                onResolved={reload}
              />
            )}
            {status === 'DISCREPANCY' && type === 'DEPOSIT' && (
              <ManualDepositLink
                depositTxId={row.id as string}
                depositAmount={Number(row.amount)}
                currency={row.currency as string}
                onResolved={reload}
              />
            )}
            {(status === 'PENDING_SC' || status === 'PENDING_P') && (
              <SuggestMatchButton
                transactionId={row.id as string}
                onResolved={reload}
                bestMatch={matchInfo[row.id as string] ?? undefined}
              />
            )}
          </div>
        )
      },
    }] : []),
  ]
  return columns
}
