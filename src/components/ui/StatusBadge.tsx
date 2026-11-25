type Status = 'MATCHED' | 'PENDING_SC' | 'PENDING_P' | 'DISCREPANCY' | 'WASTE'

const MAP: Record<Status, { label: string; cls: string }> = {
  MATCHED:     { label: 'مطابقة',         cls: 'badge-matched' },
  PENDING_SC:  { label: 'شام كاش فقط',    cls: 'badge-pending-sc' },
  PENDING_P:   { label: 'المنصة فقط',     cls: 'badge-pending-p' },
  DISCREPANCY: { label: 'فارق في المبلغ', cls: 'badge-discrepancy' },
  WASTE:       { label: 'هدر',            cls: 'badge-waste' },
}

export default function StatusBadge({ status }: { status: string }) {
  const s = MAP[status as Status] || { label: status, cls: 'badge bg-gray-100 text-gray-600' }
  return <span className={`badge ${s.cls}`}>{s.label}</span>
}
