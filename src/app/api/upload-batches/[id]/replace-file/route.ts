import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import {
  UserRole, TransactionStatus, TransactionType, TransactionSource,
} from '@/lib/db/prisma-types'
import { parseShamCashFile } from '@/lib/parsers/shamCash'
import { parsePlatformDepositsFile } from '@/lib/parsers/platformDeposits'
import { parsePlatformWithdrawalsFile } from '@/lib/parsers/platformWithdrawals'
import { unlinkPartnersOf } from '@/lib/reconciliation/unlink'

// POST /api/upload-batches/[id]/replace-file
//
// Replace ONE of the three files inside an existing UploadBatch without
// touching the other two. The new file's rows are diffed against the existing
// rows-of-that-type-in-this-batch by natural id (shamCashTxId / platformTxId):
//   - same id, same fields → updated in place (preserves matchedTxId, status,
//     review fields, notes). Match preservation is the whole point.
//   - same id, different fields → updated; if amount changed on a matched
//     row, status MATCHED ↔ DISCREPANCY is recomputed against the partner.
//   - id present in old, absent in new → row removed. If it was MATCHED/
//     DISCREPANCY, partner is unlinked back to PENDING_*.
//   - id absent in old, present in new → row inserted as PENDING_SC/PENDING_P.
//
// Auto-matching of fresh PENDING rows is NOT performed here — the user can
// use the existing "ربط يدوي" / suggest-match flows. Documented in the
// audit log and the success toast.
//
// Auth: ADMIN / SUPERVISOR. Audited as REPLACE_BATCH_FILE.

export const runtime = 'nodejs'
export const maxDuration = 120
const MAX_BYTES = 50 * 1024 * 1024 // matches /api/upload limit

type FileType = 'shamCash' | 'deposits' | 'withdrawals'

interface NewRow {
  txId: string
  amount: number
  currency: string
  txDateTime: Date | null
  rawData: unknown
  // For SC: rows can be either deposit-direction (receive) or withdrawal
  // (send). For platform deposits/withdrawals, type is fixed by the file.
  txType: TransactionType
  notes?: string
  platformUserId?: string | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.SUPERVISOR])

    const batchId = params.id
    const batch = await db.uploadBatch.findUnique({ where: { id: batchId } })
    if (!batch) return NextResponse.json({ error: 'الدفعة غير موجودة' }, { status: 404 })

    const form = await req.formData()
    const fileType = form.get('fileType')
    const file = form.get('file')
    if (
      typeof fileType !== 'string' ||
      !['shamCash', 'deposits', 'withdrawals'].includes(fileType)
    ) {
      return NextResponse.json({ error: 'fileType غير صالح' }, { status: 400 })
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'الملف غير موجود' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `الملف ${file.name} يتجاوز الحد المسموح (50MB)` }, { status: 400 })
    }

    const url = new URL(req.url)
    const confirmEmpty = url.searchParams.get('confirmEmpty') === 'true'

    // ── Parse the incoming file ────────────────────────────────────────────
    const buf = Buffer.from(await file.arrayBuffer())
    let rows: NewRow[] = []
    let parseErrors: string[] = []
    if (fileType === 'shamCash') {
      const r = await parseShamCashFile(buf)
      parseErrors = r.errors
      rows = r.rows.map(row => ({
        txId: row.txId,
        amount: row.type === TransactionType.DEPOSIT ? row.receivedAmount : row.sentAmount,
        currency: row.currency,
        txDateTime: row.txDateTime ?? null,
        rawData: row,
        txType: row.type,
        notes: row.notes,
        platformUserId: null,
      }))
    } else if (fileType === 'deposits') {
      const r = await parsePlatformDepositsFile(buf)
      parseErrors = r.errors
      rows = r.rows.map(row => ({
        txId: row.txId,
        amount: row.amount,
        currency: row.currency,
        txDateTime: row.depositTime ?? row.createdAt ?? null,
        rawData: row,
        txType: TransactionType.DEPOSIT,
        platformUserId: row.userId ?? null,
      }))
    } else {
      const r = await parsePlatformWithdrawalsFile(buf)
      parseErrors = r.errors
      rows = r.rows.map(row => ({
        txId: row.txId,
        amount: row.amount,
        currency: row.currency,
        txDateTime: row.payoutTime ?? row.withdrawalTime ?? null,
        rawData: row,
        txType: TransactionType.WITHDRAWAL,
        platformUserId: row.userId ?? null,
      }))
    }

    if (parseErrors.length > 0) {
      return NextResponse.json(
        {
          error: 'تعذّر قراءة الملف: ' + parseErrors.slice(0, 3).join('؛ '),
          details: parseErrors,
        },
        { status: 400 },
      )
    }

    // ── Scope: which existing rows in this batch this file replaces ────────
    const scope = scopeForFileType(fileType as FileType, batchId)
    const existing = await db.transaction.findMany({
      where: scope,
      select: {
        id: true,
        shamCashTxId: true,
        platformTxId: true,
        amount: true,
        currency: true,
        status: true,
        matchedTxId: true,
        type: true,
      },
    })

    // Safety: an empty replacement against a non-empty scope requires explicit
    // confirmation — guards against accidentally wiping a section.
    if (rows.length === 0 && existing.length > 0 && !confirmEmpty) {
      return NextResponse.json(
        {
          error: `الملف فارغ لكن الدفعة تحوي ${existing.length} عملية من هذا النوع. أعد المحاولة بـ ?confirmEmpty=true لتأكيد الحذف.`,
          requireConfirmEmpty: true,
        },
        { status: 400 },
      )
    }

    // ── Diff ──────────────────────────────────────────────────────────────
    const naturalKey: 'shamCashTxId' | 'platformTxId' =
      fileType === 'shamCash' ? 'shamCashTxId' : 'platformTxId'

    type ExRow = (typeof existing)[number]
    const existingByKey = new Map<string, ExRow>()
    for (const r of existing) {
      const k = r[naturalKey]
      if (k) existingByKey.set(k, r)
    }
    const newByKey = new Map<string, NewRow>()
    for (const r of rows) newByKey.set(r.txId, r)

    const survivors: Array<{ existing: ExRow; incoming: NewRow }> = []
    const removed: ExRow[] = []
    for (const ex of existing) {
      const k = ex[naturalKey]
      const inc = k ? newByKey.get(k) : undefined
      if (inc) survivors.push({ existing: ex, incoming: inc })
      else removed.push(ex)
    }
    const inserted: NewRow[] = []
    for (const inc of rows) {
      if (!existingByKey.has(inc.txId)) inserted.push(inc)
    }

    let unlinkedCount = 0
    let discrepancyAdjustments = 0

    // ── Apply changes ─────────────────────────────────────────────────────
    await db.$transaction(async (tx: typeof db) => {
      // Serialize against concurrent uploads to the same account, like the
      // batch processor does.
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
        `batch:${batch.accountId}`,
      )

      // 1) Unlink partners for any MATCHED/DISCREPANCY rows we're about to
      // remove, then delete the removed rows.
      const removedIds = removed.map(r => r.id)
      const matchedRemovedIds = removed
        .filter(r => r.matchedTxId)
        .map(r => r.id)
      if (matchedRemovedIds.length > 0) {
        const u = await unlinkPartnersOf(matchedRemovedIds, tx)
        unlinkedCount = u.unlinkedPartnerIds.length
      }
      if (removedIds.length > 0) {
        // Break any remaining FK cycles before delete.
        await tx.transaction.updateMany({
          where: { id: { in: removedIds } },
          data: { matchedTxId: null },
        })
        await tx.transaction.deleteMany({ where: { id: { in: removedIds } } })
      }

      // 2) Update survivors. Field-by-field update (no createMany upsert in
      // Prisma without a real unique-constraint; we settle for per-row).
      for (const { existing: ex, incoming } of survivors) {
        const oldAmount = Number(ex.amount)
        const amountChanged = Math.abs(oldAmount - incoming.amount) > 0.001
        const isLinked = !!ex.matchedTxId
        // If the amount changes on a linked row, re-evaluate MATCHED/
        // DISCREPANCY by comparing against the partner's amount.
        let newStatus = ex.status
        let newAmountDiff: number | null = null
        if (amountChanged && isLinked && ex.matchedTxId) {
          const partner = await tx.transaction.findUnique({
            where: { id: ex.matchedTxId },
            select: { amount: true },
          })
          if (partner) {
            const diff = Math.abs(incoming.amount - Number(partner.amount))
            newAmountDiff = diff < 0.01 ? null : diff
            newStatus = diff < 0.01
              ? TransactionStatus.MATCHED
              : TransactionStatus.DISCREPANCY
            if (newStatus !== ex.status) discrepancyAdjustments++
            // Mirror amountDiff on partner (status is recomputed from amount
            // tolerance — same value on both sides).
            await tx.transaction.update({
              where: { id: ex.matchedTxId },
              data: { amountDiff: newAmountDiff, status: newStatus },
            })
          }
        }
        await tx.transaction.update({
          where: { id: ex.id },
          data: {
            amount: incoming.amount,
            currency: incoming.currency,
            ...(incoming.txDateTime ? { txDateTime: incoming.txDateTime } : {}),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            rawData: incoming.rawData as any,
            ...(amountChanged && isLinked
              ? { status: newStatus, amountDiff: newAmountDiff }
              : {}),
            // Preserve: matchedTxId, reviewCategory, reviewNotes, notes,
            // followUpStatus, handledByUserId, handlerAmbiguous.
          },
        })
      }

      // 3) Insert new rows as fresh PENDING_*. Matching is left to the
      // existing manual workflow.
      if (inserted.length > 0) {
        const records = inserted.map(r => buildInsertRecord({
          accountId: batch.accountId,
          batchId,
          fileType: fileType as FileType,
          row: r,
        }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.transaction.createMany({ data: records as any })
      }

      // 4) Refresh batch metadata.
      const newCount = await tx.transaction.count({ where: { batchId } })
      await tx.uploadBatch.update({
        where: { id: batchId },
        data: { rowsProcessed: newCount, processedAt: new Date() },
      })
    })

    const stats = {
      fileType,
      updated: survivors.length,
      inserted: inserted.length,
      removed: removed.length,
      unlinked: unlinkedCount,
      discrepancyAdjusted: discrepancyAdjustments,
      newMatches: 0,
    }

    await audit(session.userId, 'REPLACE_BATCH_FILE', 'UploadBatch', batchId, stats)

    return NextResponse.json({ success: true, stats })
  } catch (error) {
    console.error('Replace-file error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

function scopeForFileType(t: FileType, batchId: string): Record<string, unknown> {
  if (t === 'shamCash') return { batchId, source: TransactionSource.SHAM_CASH }
  if (t === 'deposits') return { batchId, source: TransactionSource.PLATFORM, type: TransactionType.DEPOSIT }
  return { batchId, source: TransactionSource.PLATFORM, type: TransactionType.WITHDRAWAL }
}

function buildInsertRecord({
  accountId, batchId, fileType, row,
}: {
  accountId: string
  batchId: string
  fileType: FileType
  row: NewRow
}): Record<string, unknown> {
  const source = fileType === 'shamCash'
    ? TransactionSource.SHAM_CASH
    : TransactionSource.PLATFORM
  const status = source === TransactionSource.SHAM_CASH
    ? TransactionStatus.PENDING_SC
    : TransactionStatus.PENDING_P
  const base: Record<string, unknown> = {
    accountId,
    batchId,
    source,
    type: row.txType,
    status,
    amount: row.amount,
    currency: row.currency,
    txDateTime: row.txDateTime ?? new Date(),
    rawData: row.rawData,
  }
  if (fileType === 'shamCash') {
    base.shamCashTxId = row.txId
  } else {
    base.platformTxId = row.txId
    if (row.platformUserId) base.platformUserId = row.platformUserId
  }
  if (row.notes) base.notes = row.notes
  return base
}
