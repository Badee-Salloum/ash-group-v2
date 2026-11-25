'use client'
// Pending dues hero card for the Overview tab. Shows total unpaid payroll
// + unpaid bonuses; clicking "الذهاب للرواتب" deep-links into the Payroll
// tab with an active "unpaid" filter chip.

import { Wallet, Gift, CheckCircle2, ArrowLeft } from 'lucide-react'

export interface PendingDues {
  pendingPayrollCount: number
  pendingPayrollAmount: number
  pendingBonusCount: number
  pendingBonusAmount: number
}

interface Props {
  dues: PendingDues
  onOpenPayroll: () => void
}

export function PendingDuesCard({ dues, onOpenPayroll }: Props) {
  const total = dues.pendingPayrollAmount + dues.pendingBonusAmount
  const hasAny = dues.pendingPayrollCount > 0 || dues.pendingBonusCount > 0

  // Empty state — compact green card to reassure the manager that nothing
  // is owed (instead of hiding the card silently).
  if (!hasAny) {
    return (
      <div className="card p-3 flex items-center gap-2.5 bg-emerald-50/50 border-emerald-200">
        <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-emerald-800">
            🎉 لا مستحقات معلّقة لهذه الفترة
          </p>
          <p className="text-[11px] text-emerald-700/80">
            كل الرواتب والمكافآت مدفوعة.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="card p-4 bg-gradient-to-l from-amber-50/40 to-white border-amber-200">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-gray-900 inline-flex items-center gap-2">
            💰 المستحقات المعلّقة
          </h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            إجمالي ما يجب دفعه ضمن الفترة المختارة.
          </p>
        </div>
        <button
          onClick={onOpenPayroll}
          className="btn-primary btn-sm inline-flex items-center gap-1.5"
        >
          الذهاب للرواتب
          <ArrowLeft size={13} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-3">
        <DueBox
          icon={<Wallet size={16} className="text-emerald-600" />}
          label="رواتب"
          count={dues.pendingPayrollCount}
          amount={dues.pendingPayrollAmount}
          tone="emerald"
        />
        <DueBox
          icon={<Gift size={16} className="text-violet-600" />}
          label="مكافآت"
          count={dues.pendingBonusCount}
          amount={dues.pendingBonusAmount}
          tone="violet"
          hint="تُدفع مع الراتب"
        />
        <div className="rounded-xl bg-amber-100/60 ring-1 ring-amber-200 p-3">
          <p className="text-[10px] text-amber-700 font-bold uppercase mb-0.5">
            الإجمالي
          </p>
          <p className="font-mono font-bold text-lg text-amber-900">
            {total.toLocaleString('en')}
            <span className="text-xs font-normal text-amber-700 mr-1">ل.س</span>
          </p>
        </div>
      </div>
    </div>
  )
}

function DueBox({
  icon, label, count, amount, tone, hint,
}: {
  icon: React.ReactNode
  label: string
  count: number
  amount: number
  tone: 'emerald' | 'violet'
  hint?: string
}) {
  const ring = tone === 'emerald' ? 'ring-emerald-200' : 'ring-violet-200'
  return (
    <div className={`rounded-xl bg-white ring-1 ${ring} p-3`}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs font-bold text-gray-700">{label}</span>
        <span className="text-[10px] text-gray-400">·</span>
        <span className="text-[10px] font-mono text-gray-500">
          {count} سجل
        </span>
      </div>
      <p className="font-mono font-bold text-base text-gray-900">
        {amount.toLocaleString('en')}
        <span className="text-[11px] font-normal text-gray-500 mr-1">ل.س</span>
      </p>
      {hint && (
        <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>
      )}
    </div>
  )
}
