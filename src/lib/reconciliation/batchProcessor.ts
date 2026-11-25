import { db } from '@/lib/db/client'
import { parseShamCashFile } from '@/lib/parsers/shamCash'
import { parsePlatformDepositsFile } from '@/lib/parsers/platformDeposits'
import { parsePlatformWithdrawalsFile } from '@/lib/parsers/platformWithdrawals'
import { assertValidImports } from '@/lib/parsers/validation'
import { resolveHistoricalComplaints } from '@/lib/reconciliation/deposits'
import { TransactionStatus, TransactionType, TransactionSource } from '@/lib/db/prisma-types'
import { audit } from '@/lib/auth'
import { runDepositStep } from './batchProcessor.deposits'
import { runWithdrawalStep } from './batchProcessor.withdrawals'
import {
  applyResolvedComplaints,
  applyHistoricalScIdMatches,
  applyHistoricalPlatformOnlyMatches,
  applyHistoricalWithdrawalScIdMatches,
  applyHistoricalWithdrawalPlatformOnlyMatches,
} from './batchProcessor.historical'
import { dedupAgainstExisting, bulkInsertRecords, linkMatchedPairs, rollbackBatch } from './batchProcessor.persist'
import { runAutoConsolidation, runEmployeeLinking } from './batchProcessor.consolidation'
import { upsertCustomerNamesFromBatch } from './customerNames'
import { enrichTransactionRecords } from './derivedFields'
import { invalidateFinancialReadModels } from '@/lib/performance/cache'
import { syncTransactionReadModels } from '@/lib/performance/readModels'
import { automaticReadModelChanges } from './autoLink'

export interface BatchFiles {
  // All three are optional — the upload page lets the user submit 1, 2, or 3
  // files. Missing slots become empty `{ rows: [], errors: [] }` parser
  // results so the rest of the pipeline is unaffected.
  shamCashBuffer?: Buffer
  depositsBuffer?: Buffer
  withdrawalsBuffer?: Buffer
}

export async function processBatch(
  accountId: string,
  files: BatchFiles,
  uploadedBy: string,
  stage: (name: string, extra?: Record<string, unknown>) => Promise<void> = async () => {},
): Promise<{ batchId: string; summary: Record<string, number> }> {
  // Validate before opening a batch or touching historical transactions. A
  // partially parsed financial file must not silently become a successful upload.
  await stage('PARSING')
  const [scResult, depResult, wdResult] = await Promise.all([
    files.shamCashBuffer ? parseShamCashFile(files.shamCashBuffer) : { rows: [], errors: [] },
    files.depositsBuffer ? parsePlatformDepositsFile(files.depositsBuffer) : { rows: [], errors: [] },
    files.withdrawalsBuffer ? parsePlatformWithdrawalsFile(files.withdrawalsBuffer) : { rows: [], errors: [] },
  ])
  assertValidImports([
    { label: 'شام كاش', errors: scResult.errors },
    { label: 'الإيداعات', errors: depResult.errors },
    { label: 'السحوبات', errors: wdResult.errors },
  ])
  // 0. Serialize uploads per account using a Postgres advisory lock combined
  // with the active-batch check inside ONE transaction. The advisory lock is
  // auto-released at end of the transaction.
  const batch = await db.$transaction(async (tx: typeof db) => {
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
      `batch:${accountId}`,
    )
    const active = await tx.uploadBatch.findFirst({
      where: {
        accountId,
        status: 'PROCESSING',
        createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
    })
    if (active) {
      throw new Error(
        'هناك رفعة قيد المعالجة على هذا الحساب. انتظر انتهاءها ثم حاول مجدداً.'
      )
    }
    return tx.uploadBatch.create({
      data: {
        accountId,
        batchDate: new Date(),
        status: 'PROCESSING',
        uploadedBy,
      },
    })
  })

  try {
    await stage('MATCHING', { batchId: batch.id })
    // 2. Parse the files that were actually uploaded. Missing slots fall back
    // to an empty parser result so the deposit / withdrawal reconciliation
    // steps below run with [] on one side — they tolerate that and the rows
    // end up as PENDING_SC / PENDING_P, ready for historical matching.
    // 3. Get account wallet identifiers
    const account = await db.account.findUniqueOrThrow({ where: { id: accountId } })

    // 4 + 4.5. Deposit reconciliation + historical SC-ID matches + record build
    const dep = await runDepositStep(
      accountId, batch.id, scResult.rows, depResult.rows, account.walletIdentifiers,
    )

    // 5 + 6. Withdrawal reconciliation + cross-match + record build
    const wd = runWithdrawalStep(
      accountId, batch.id, scResult.rows, wdResult.rows, depResult.rows,
      account.walletIdentifiers, dep.matchedSCByDeposits, dep.usedDepositPlatformIds,
    )

    // 7. Check historical PENDING_SC transactions for complaint resolution
    const historicalPendingSC = await db.transaction.findMany({
      where: {
        accountId,
        status: TransactionStatus.PENDING_SC,
        type: TransactionType.DEPOSIT,
        source: TransactionSource.SHAM_CASH, matchedTxId: null, reviewCategory: null,
      },
      select: { id: true, platformUserId: true, amount: true, currency: true, txDateTime: true },
    })

    const resolved = resolveHistoricalComplaints(
      historicalPendingSC.map((t: { id: string; platformUserId: string | null; amount: unknown; currency: string; txDateTime: Date }) => ({
        id: t.id,
        platformUserId: t.platformUserId,
        amount: Number(t.amount),
        currency: t.currency,
        txDateTime: t.txDateTime,
      })),
      depResult.rows
    )

    // 8. Persist all transactions using BULK INSERT for performance
    const summary: Record<string, number> = {
      depositMatched: dep.depReconciliation.matched.length,
      depositSCOnly: dep.depReconciliation.shamCashOnly.length,
      depositPlatformOnly: dep.depReconciliation.platformOnly.length,
      depositDiscrepancy: dep.depReconciliation.discrepancySCHigher.length + dep.depReconciliation.discrepancyPHigher.length
        + wd.crossMatched.filter(pair => pair.matchType !== 'MATCHED').length,
      withdrawalMatched: wd.wdReconciliation.matched.length,
      withdrawalSCOnly: wd.finalUnmatchedSCSends.length,
      withdrawalPlatformOnly: wd.wdReconciliation.platformOnly.length,
      withdrawalDiscrepancy: wd.wdReconciliation.discrepancySCHigher.length + wd.wdReconciliation.discrepancyPHigher.length,
      depositInternalTransfers: dep.depReconciliation.internalTransfers.length,
      withdrawalInternalTransfers: wd.wdReconciliation.internalTransfers.length,
      internalTransfers: dep.depReconciliation.internalTransfers.length + wd.wdReconciliation.internalTransfers.length,
      crossMatched: wd.crossMatched.filter(pair => pair.matchType === 'MATCHED').length,
      complaintsResolved: resolved.length,
    }

    // Combine deposit + withdrawal records.
    // Cross-match (SC ارسال × Platform DEPOSIT by TX ID) consumes deposit-side
    // platform rows that runDepositStep had marked PENDING_P. Drop those
    // PENDING_P records — the cross-match created MATCHED records to replace
    // them.
    const consumedByCross = new Set(wd.crossMatched.map(c => c.platform.txId))
    const filteredDepRecords = consumedByCross.size === 0
      ? dep.records
      : dep.records.filter(r =>
          !(r.source === TransactionSource.PLATFORM
            && r.type === TransactionType.DEPOSIT
            && r.status === TransactionStatus.PENDING_P
            && typeof r.platformTxId === 'string'
            && consumedByCross.has(r.platformTxId)),
        )
    if (consumedByCross.size > 0) {
      summary.depositPlatformOnly -= (dep.records.length - filteredDepRecords.length)
    }
    const allRecords: Array<Record<string, unknown>> = [...filteredDepRecords, ...wd.records]
    const matchedPairs: Array<[string, string]> = [...dep.matchedPairs, ...wd.matchedPairs]

    // Persist lightweight fields alongside raw import JSON. List endpoints can
    // now render/search customers and exclude internal wallet traffic without
    // loading a JSON blob for every row.
    enrichTransactionRecords(allRecords, account.walletIdentifiers)

    // ── Deduplicate against existing DB rows ──
    const skippedAsDuplicate = await dedupAgainstExisting(accountId, allRecords, matchedPairs)
    summary.skippedAsDuplicate = skippedAsDuplicate

    // BULK INSERT all remaining records at once
    await stage('PERSISTING')
    await db.$transaction(async (tx: typeof db) => {
      await bulkInsertRecords(allRecords, tx)
      await linkMatchedPairs(matchedPairs, tx)
    }, { maxWait: 10000, timeout: 25000 })

    // ── Resolve historical complaints (updates existing records) ──
    await stage('HISTORICAL')
    summary.complaintsResolved = await applyResolvedComplaints(accountId, batch.id, resolved)

    // ── Historical SC-ID matches: update old PENDING_SC and create new platform rows ──
    const historicalScIds = await applyHistoricalScIdMatches(
      accountId, batch.id, dep.historicalMatchesByScTxId,
    )
    summary.depositPlatformOnly = Math.max(0, summary.depositPlatformOnly
      - summary.complaintsResolved - historicalScIds.resolved - historicalScIds.discrepancy)

    // ── Historical platform-only matches: link old PENDING_P platform rows
    // to freshly-uploaded SC rows (the reverse of the above). For each SC row
    // in this batch, find any old PENDING_P platform whose shamCashTxId was
    // already extracted but had no SC partner — promote both to MATCHED.
    const allScTxIdsInBatch = Array.from(new Set([
      ...dep.depReconciliation.matched.map(p => p.shamCash.txId),
      ...dep.depReconciliation.shamCashOnly.map(s => s.txId),
      ...dep.depReconciliation.discrepancySCHigher.map(d => d.shamCash.txId),
      ...dep.depReconciliation.discrepancyPHigher.map(d => d.shamCash.txId),
    ]))
    const platLinked = await applyHistoricalPlatformOnlyMatches(accountId, allScTxIdsInBatch)
    summary.historicalPlatformLinked = platLinked.updated

    // ── Withdrawal retro-match (both directions) ──
    // Mirror of the deposit historical passes above. Rescues rows left as
    // PENDING_SC / PENDING_P by prior split-batch uploads (SC file uploaded
    // separately from Platform file). See batchProcessor.historical.ts.
    const wdHistPlat = await applyHistoricalWithdrawalScIdMatches(
      accountId, wd.wdReconciliation.platformOnly,
    )
    const allScWithdrawalTxIdsInBatch = Array.from(new Set([
      ...wd.wdReconciliation.matched.map(p => p.shamCash.txId),
      ...wd.finalUnmatchedSCSends.map(s => s.txId),
      ...wd.wdReconciliation.discrepancySCHigher.map(d => d.shamCash.txId),
      ...wd.wdReconciliation.discrepancyPHigher.map(d => d.shamCash.txId),
    ]))
    const wdHistSc = await applyHistoricalWithdrawalPlatformOnlyMatches(
      accountId, allScWithdrawalTxIdsInBatch,
    )
    summary.historicalWithdrawalLinked = wdHistPlat.updated + wdHistSc.updated

    // ── Persist customer names from MATCHED records ──
    // Run after all linking so historical matches also contribute names.
    // Defensive: never throws — silently no-ops if customers table is missing.
    await upsertCustomerNamesFromBatch(
      allRecords as unknown as ReadonlyArray<{
        source: string; status: string; platformUserId?: string | null; rawData?: unknown
      }>,
    )

    // 9. Update batch status
    const totalRows = summary.depositMatched + summary.depositSCOnly +
      summary.depositPlatformOnly + summary.withdrawalMatched +
      summary.withdrawalSCOnly + summary.withdrawalPlatformOnly +
      summary.crossMatched + summary.depositDiscrepancy + summary.withdrawalDiscrepancy
      + historicalScIds.resolved + historicalScIds.discrepancy

    summary.complaintsResolved += historicalScIds.resolved
    summary.depositDiscrepancy += historicalScIds.discrepancy

    // Auto-consolidate PENDING_SC operations by net (deposits - withdrawals) per account
    await stage('CONSOLIDATING')
    await runAutoConsolidation(accountId, uploadedBy, batch.id, summary)

    // Module D: link this batch's transactions to the employees who handled them
    await stage('EMPLOYEES')
    await runEmployeeLinking(batch.id, summary)

    // Tag partial uploads in the audit log so the trail captures which sides
    // came in for this batch (helps reading back-history later).
    const uploadedSides = {
      shamCash: !!files.shamCashBuffer,
      deposits: !!files.depositsBuffer,
      withdrawals: !!files.withdrawalsBuffer,
    }
    const auditDetails: Record<string, unknown> = { ...summary }
    if (!uploadedSides.shamCash || !uploadedSides.deposits || !uploadedSides.withdrawals) {
      auditDetails.partial = uploadedSides
    }

    // Maintain only the affected customer/day/duplicate groups. This is a
    // dual-write of the additive read models, not a full historical rebuild.
    // The helper is best-effort internally; a failed refresh is recoverable
    // through the resumable backfill and cannot invalidate an uploaded batch.
    await stage('SUMMARIES')
    const linkedChanges = await automaticReadModelChanges(accountId, batch.createdAt).catch(() => {
      summary.summaryRefreshWarning = 1
      return []
    })
    const summariesReady = await syncTransactionReadModels(
      [...allRecords
        .map(record => ({
          accountId,
          txDateTime: record.txDateTime as Date | string,
          customerName: typeof record.customerName === 'string' ? record.customerName : null,
          shamCashTxId: typeof record.shamCashTxId === 'string' ? record.shamCashTxId : null,
        }))
        .filter(record => record.txDateTime instanceof Date || typeof record.txDateTime === 'string'), ...linkedChanges],
    )
    if (summariesReady === false) summary.summaryRefreshWarning = 1
    Object.assign(auditDetails, summary)

    // Cached dashboard/customer/duplicate read models are permission-scoped,
    // but a completed upload must still become visible immediately.
    invalidateFinancialReadModels()

    await db.$transaction(async (tx: typeof db) => {
      await audit(uploadedBy, 'UPLOAD_BATCH', 'UploadBatch', batch.id, auditDetails, undefined, tx)
      await tx.uploadBatch.update({ where: { id: batch.id },
        data: { status: 'COMPLETED', processedAt: new Date(), rowsProcessed: totalRows } })
    })

    return { batchId: batch.id, summary }
  } catch (error) {
    await rollbackBatch(batch.id, error)
    throw error
  }
}
