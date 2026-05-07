import { db } from '@/lib/db/client'
import { parseShamCashFile } from '@/lib/parsers/shamCash'
import { parsePlatformDepositsFile } from '@/lib/parsers/platformDeposits'
import { parsePlatformWithdrawalsFile } from '@/lib/parsers/platformWithdrawals'
import { resolveHistoricalComplaints } from '@/lib/reconciliation/deposits'
import { TransactionStatus, TransactionType, TransactionSource } from '@/lib/db/prisma-types'
import { audit } from '@/lib/auth'
import { runDepositStep } from './batchProcessor.deposits'
import { runWithdrawalStep } from './batchProcessor.withdrawals'
import { applyResolvedComplaints, applyHistoricalScIdMatches, applyHistoricalPlatformOnlyMatches } from './batchProcessor.historical'
import { dedupAgainstExisting, bulkInsertRecords, linkMatchedPairs, rollbackBatch } from './batchProcessor.persist'
import { runAutoConsolidation, runEmployeeLinking } from './batchProcessor.consolidation'
import { upsertCustomerNamesFromBatch } from './customerNames'

export interface BatchFiles {
  shamCashBuffer: Buffer
  depositsBuffer: Buffer
  withdrawalsBuffer: Buffer
}

export async function processBatch(
  accountId: string,
  files: BatchFiles,
  uploadedBy: string
): Promise<{ batchId: string; summary: Record<string, number> }> {
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
    // 2. Parse all files
    const [scResult, depResult, wdResult] = await Promise.all([
      parseShamCashFile(files.shamCashBuffer),
      parsePlatformDepositsFile(files.depositsBuffer),
      parsePlatformWithdrawalsFile(files.withdrawalsBuffer),
    ])

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
      },
      select: { id: true, platformUserId: true, amount: true, txDateTime: true },
    })

    const resolved = resolveHistoricalComplaints(
      historicalPendingSC.map((t: { id: string; platformUserId: string | null; amount: unknown; txDateTime: Date }) => ({
        id: t.id,
        platformUserId: t.platformUserId,
        amount: Number(t.amount),
        txDateTime: t.txDateTime,
      })),
      depResult.rows
    )

    // 8. Persist all transactions using BULK INSERT for performance
    const summary: Record<string, number> = {
      depositMatched: dep.depReconciliation.matched.length,
      depositSCOnly: dep.depReconciliation.shamCashOnly.length,
      depositPlatformOnly: dep.depReconciliation.platformOnly.length,
      depositDiscrepancy: dep.depReconciliation.discrepancySCHigher.length + dep.depReconciliation.discrepancyPHigher.length,
      withdrawalMatched: wd.wdReconciliation.matched.length,
      withdrawalSCOnly: wd.finalUnmatchedSCSends.length,
      withdrawalPlatformOnly: wd.wdReconciliation.platformOnly.length,
      withdrawalDiscrepancy: wd.wdReconciliation.discrepancySCHigher.length + wd.wdReconciliation.discrepancyPHigher.length,
      depositInternalTransfers: dep.depReconciliation.internalTransfers.length,
      withdrawalInternalTransfers: wd.wdReconciliation.internalTransfers.length,
      internalTransfers: dep.depReconciliation.internalTransfers.length + wd.wdReconciliation.internalTransfers.length,
      crossMatched: wd.crossMatched.length,
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

    // ── Deduplicate against existing DB rows ──
    const skippedAsDuplicate = await dedupAgainstExisting(accountId, allRecords, matchedPairs)
    summary.skippedAsDuplicate = skippedAsDuplicate

    // BULK INSERT all remaining records at once
    await bulkInsertRecords(allRecords)

    // Link matched pairs via matchedTxId in a second pass to avoid FK violations
    await linkMatchedPairs(matchedPairs)

    // ── Resolve historical complaints (updates existing records) ──
    await applyResolvedComplaints(accountId, batch.id, resolved)

    // ── Historical SC-ID matches: update old PENDING_SC and create new platform rows ──
    const historicalScIds = await applyHistoricalScIdMatches(
      accountId, batch.id, dep.historicalMatchesByScTxId,
    )

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
      summary.crossMatched + historicalScIds.resolved + historicalScIds.discrepancy

    summary.complaintsResolved += historicalScIds.resolved
    summary.depositDiscrepancy += historicalScIds.discrepancy

    await db.uploadBatch.update({
      where: { id: batch.id },
      data: { status: 'COMPLETED', processedAt: new Date(), rowsProcessed: totalRows },
    })

    // Auto-consolidate PENDING_SC operations by net (deposits - withdrawals) per account
    await runAutoConsolidation(accountId, uploadedBy, batch.id, summary)

    // Module D: link this batch's transactions to the employees who handled them
    await runEmployeeLinking(batch.id, summary)

    await audit(uploadedBy, 'UPLOAD_BATCH', 'UploadBatch', batch.id, summary)

    return { batchId: batch.id, summary }
  } catch (error) {
    await rollbackBatch(batch.id, error)
    throw error
  }
}
