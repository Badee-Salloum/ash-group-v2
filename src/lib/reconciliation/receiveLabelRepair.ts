import { sameCurrency } from './currencyGuard'

/** Pure, narrowly scoped repair plan. Never infers amounts from a partner. */
export type ReceiveRepairRow = {
  id: string; accountId: string; batchId: string; source: string; type: string; status: string
  amount: string | number; currency: string; shamCashTxId: string | null; platformTxId: string | null
  platformUserId: string | null; matchedTxId: string | null; reviewCategory: string | null
  amountDiff: string | number | null; rawData: Record<string, unknown>; notes: string | null
  isInternalTransferAuto: boolean
}
export type ReceiveRepairPatch = {
  id: string; type: string; status: string; amount: string; amountDiff: string | null
  matchedTxId: string | null; platformTxId: string | null; platformUserId: string | null
  shamCashTxId: string | null; rawData: Record<string, unknown>; notes: string | null
  isInternalTransferAuto: boolean
}

export function isBrokenReceive(row: ReceiveRepairRow): boolean {
  return row.source === 'SHAM_CASH' && Number(row.amount) === 0
    && row.rawData?.type === 'WITHDRAWAL'
    && Number(row.rawData.receivedAmount) > 0 && Number(row.rawData.sentAmount) === 0
}

export function planReceiveRepair(sc: ReceiveRepairRow, partner?: ReceiveRepairRow): ReceiveRepairPatch[] {
  if (!isBrokenReceive(sc) || sc.reviewCategory !== null || !['MATCHED', 'PENDING_SC'].includes(sc.status)) {
    throw new Error('Unsupported or manually reviewed receive; no automatic overwrite')
  }
  const amount = Number(sc.rawData.receivedAmount)
  if (!Number.isFinite(amount) || amount >= 10 ** 13
    || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001
    || sc.rawData.txId !== sc.shamCashTxId) throw new Error('Invalid original receive evidence')
  if (sc.matchedTxId && !partner) throw new Error('Missing original partner')
  const patch: ReceiveRepairPatch = {
    id: sc.id, type: 'DEPOSIT', status: sc.status, amount: amount.toFixed(2), amountDiff: null,
    matchedTxId: sc.matchedTxId, platformTxId: sc.platformTxId, platformUserId: sc.platformUserId,
    shamCashTxId: sc.shamCashTxId, rawData: { ...sc.rawData, type: 'DEPOSIT' }, notes: sc.notes,
    isInternalTransferAuto: sc.isInternalTransferAuto,
  }
  if (!partner) return [patch]
  const existing = sc.matchedTxId !== null
  if (partner.accountId !== sc.accountId || partner.source !== 'PLATFORM' || partner.type !== 'DEPOSIT'
    || partner.reviewCategory !== null || !sameCurrency(sc.currency, partner.currency)
    || (existing ? partner.id !== sc.matchedTxId || partner.matchedTxId !== sc.id || partner.status !== 'MATCHED'
      : partner.matchedTxId !== null || partner.status !== 'PENDING_P' || partner.batchId !== sc.batchId
        || partner.shamCashTxId !== sc.shamCashTxId)) throw new Error('Unsafe receive pairing')
  const platformAmount = Number(partner.amount)
  if (!Number.isFinite(platformAmount) || platformAmount < 0) throw new Error('Invalid platform amount')
  const difference = Math.abs(Math.round(amount * 100) - Math.round(platformAmount * 100)) / 100
  const status = difference === 0 ? 'MATCHED' : 'DISCREPANCY'
  // Keep both existing records. On a discrepancy only the higher side carries
  // the difference, so waste/extras aggregates do not charge it twice.
  Object.assign(patch, {
    status, matchedTxId: partner.id, platformTxId: partner.platformTxId, platformUserId: partner.platformUserId,
    amountDiff: difference === 0 ? null : (amount > platformAmount ? difference : 0).toFixed(2),
    isInternalTransferAuto: false,
    notes: sc.notes === 'internal-transfer' ? null : sc.notes,
  })
  return [patch, {
    id: partner.id, type: partner.type, status, amount: platformAmount.toFixed(2),
    amountDiff: difference === 0 ? null : (platformAmount > amount ? difference : 0).toFixed(2),
    matchedTxId: sc.id, platformTxId: partner.platformTxId, platformUserId: partner.platformUserId,
    shamCashTxId: sc.shamCashTxId, rawData: partner.rawData, notes: partner.notes,
    isInternalTransferAuto: false,
  }]
}
