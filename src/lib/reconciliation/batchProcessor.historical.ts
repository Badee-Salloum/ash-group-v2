import { db } from '@/lib/db/client'
import { createId } from '@paralleldrive/cuid2'
import { resolveHistoricalComplaints } from './deposits'
import type { HistoricalScIdMatch } from './batchProcessor.deposits'
import type { PlatformWithdrawalRow } from '@/types'
import { sameCurrency, currencyMatchKey, uniqueCurrencyCandidates, type PersistedCurrencyCandidate } from './currencyGuard'
import { AutoMatchConflict, linkAutomaticPairs } from './autoLink'
import { enrichTransactionRecords } from './derivedFields'
import { upsertCustomerNamesFromBatch } from './customerNames'

type ResolvedComplaint = ReturnType<typeof resolveHistoricalComplaints>[number]
type DepositRow = HistoricalScIdMatch['platformRow']

// Creation and both live claims commit together; a conflict leaves no orphan.
async function linkDeposit(accountId: string, batchId: string, pendingId: string, platform: DepositRow, complaint = false) {
  const pending = await db.transaction.findUnique({ where: { id: pendingId } })
  if (!pending || pending.accountId !== accountId || pending.source !== 'SHAM_CASH' || pending.type !== 'DEPOSIT'
    || pending.status !== 'PENDING_SC' || pending.matchedTxId || pending.reviewCategory
    || !sameCurrency(pending.currency, platform.currency)) return null
  try {
    return await db.$transaction(async (tx: typeof db) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', 'auto-platform:' + accountId + ':' + platform.txId)
      const existing = await tx.transaction.findMany({
        where: { accountId, source: 'PLATFORM', platformTxId: platform.txId }, take: 2,
      })
      if (existing.length > 1) throw new AutoMatchConflict()
      let counterpart = existing[0]
      if (counterpart && (counterpart.type !== 'DEPOSIT' || counterpart.status !== 'PENDING_P'
        || counterpart.matchedTxId || counterpart.reviewCategory || !sameCurrency(counterpart.currency, pending.currency))) throw new AutoMatchConflict()
      if (!counterpart) {
        const records: Array<Record<string, unknown>> = [{ id: createId(), accountId, batchId, source: 'PLATFORM', type: 'DEPOSIT',
          platformTxId: platform.txId, platformUserId: platform.userId, shamCashTxId: platform.shamCashTxId,
          amount: platform.amount, currency: platform.currency, txDateTime: platform.createdAt,
          status: 'PENDING_P', rawData: platform }]
        enrichTransactionRecords(records, [])
        counterpart = await tx.transaction.create({ data: records[0] })
      }
      const statuses = await linkAutomaticPairs([[pendingId, counterpart.id]], complaint ? 'HISTORICAL_COMPLAINT' : 'HISTORICAL_DEPOSIT', tx)
      return statuses[0]
    }, { maxWait: 10000, timeout: 25000 })
  } catch (error) {
    if (error instanceof AutoMatchConflict) return null
    throw error
  }
}

export async function applyResolvedComplaints(accountId: string, batchId: string, resolved: ResolvedComplaint[]): Promise<number> {
  let updated = 0
  for (const r of resolved) if (await linkDeposit(accountId, batchId, r.pendingTxId, r.platformRow, true)) updated++
  return updated
}

export interface HistoricalScIdResult { resolved: number; discrepancy: number }
export async function applyHistoricalScIdMatches(accountId: string, batchId: string, matches: HistoricalScIdMatch[]): Promise<HistoricalScIdResult> {
  const result = { resolved: 0, discrepancy: 0 }
  for (const match of matches) {
    const status = await linkDeposit(accountId, batchId, match.pendingTxId, match.platformRow)
    if (status === 'MATCHED') result.resolved++
    if (status === 'DISCREPANCY') result.discrepancy++
  }
  return result
}

async function linkPending(accountId: string, type: 'DEPOSIT' | 'WITHDRAWAL', scIds: string[]) {
  if (!scIds.length) return { updated: 0 }
  const [scRows, platformRows] = await Promise.all([
    db.transaction.findMany({ where: { accountId, type, source: 'SHAM_CASH', status: 'PENDING_SC',
      matchedTxId: null, reviewCategory: null, shamCashTxId: { in: scIds } },
      select: { id: true, shamCashTxId: true, currency: true } }),
    db.transaction.findMany({ where: { accountId, type, source: 'PLATFORM', status: 'PENDING_P',
      matchedTxId: null, reviewCategory: null, shamCashTxId: { in: scIds } },
      select: { id: true, shamCashTxId: true, currency: true } }),
  ])
  const sc = uniqueCurrencyCandidates<PersistedCurrencyCandidate>(scRows.filter((row: PersistedCurrencyCandidate) => !row.matchedTxId))
  const platforms = uniqueCurrencyCandidates<PersistedCurrencyCandidate>(platformRows)
  let updated = 0
  const linkedIds: string[] = []
  for (const platform of platforms.values()) {
    const pending = sc.get(currencyMatchKey(platform.shamCashTxId!, platform.currency))
    if (!pending) continue
    try {
      await linkAutomaticPairs([[pending.id, platform.id]], 'HISTORICAL_' + type)
      updated++
      linkedIds.push(pending.id)
    } catch (error) {
      if (!(error instanceof AutoMatchConflict)) throw error
    }
  }
  if (linkedIds.length) {
    const linked = await db.transaction.findMany({ where: { id: { in: linkedIds } },
      select: { source: true, status: true, platformUserId: true, rawData: true } })
    await upsertCustomerNamesFromBatch(linked)
  }
  return { updated }
}

export function applyHistoricalPlatformOnlyMatches(accountId: string, scTxIds: string[]) {
  return linkPending(accountId, 'DEPOSIT', scTxIds)
}
export function applyHistoricalWithdrawalScIdMatches(accountId: string, rows: PlatformWithdrawalRow[]) {
  return linkPending(accountId, 'WITHDRAWAL', Array.from(new Set(rows.map(row => row.shamCashTxId).filter((id): id is string => !!id))))
}
export function applyHistoricalWithdrawalPlatformOnlyMatches(accountId: string, scTxIds: string[]) {
  return linkPending(accountId, 'WITHDRAWAL', scTxIds)
}

