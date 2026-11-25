import { isInternalTransfer } from './walletMatch'

type RawTransaction = Record<string, unknown>

function asObject(value: unknown): RawTransaction {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RawTransaction
    : {}
}

/**
 * Extract the few list/filter fields that previously required shipping rawData
 * back to the browser. This is called at import time, and the release backfill
 * applies the same semantics to historical transactions.
 */
export function deriveTransactionFields(
  rawData: unknown,
  walletIdentifiers: string[],
  notes?: unknown,
): { customerName: string | null; isInternalTransferAuto: boolean } {
  const raw = asObject(rawData)
  const sc = asObject(raw.sc)

  const customerName = String(raw.accountName || sc.accountName || '').trim() || null
  const accountNumber = String(raw.accountNumber || sc.accountNumber || '')
  const rawNotes = String(raw.notes || sc.notes || '')
  const noteFlag = String(notes || '').toLowerCase().includes('internal-transfer')

  return {
    customerName,
    isInternalTransferAuto: noteFlag || isInternalTransfer(
      accountNumber,
      customerName || '',
      rawNotes,
      walletIdentifiers,
    ),
  }
}

export function enrichTransactionRecords<T extends Record<string, unknown>>(
  records: T[],
  walletIdentifiers: string[],
): T[] {
  for (const record of records) {
    const derived = deriveTransactionFields(record.rawData, walletIdentifiers, record.notes)
    const mutable = record as Record<string, unknown>
    mutable.customerName = derived.customerName
    mutable.isInternalTransferAuto = derived.isInternalTransferAuto
  }
  return records
}
