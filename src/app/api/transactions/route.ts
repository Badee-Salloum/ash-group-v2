import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { TransactionStatus, TransactionType, TransactionSource, UserRole } from '@/lib/db/prisma-types'
import { requireCapability } from '@/lib/permissions/overrides'
import { PERMISSIONS } from '@/lib/permissions/keys'
import { invalidateFinancialReadModels } from '@/lib/performance/cache'
import { syncTransactionReadModels } from '@/lib/performance/readModels'
import { deriveTransactionFields } from '@/lib/reconciliation/derivedFields'
import { sameCurrency } from '@/lib/reconciliation/currencyGuard'
import { z } from 'zod'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    // Front-line EMPLOYEEs never see transaction/financial data.
    if (session.role === UserRole.EMPLOYEE) {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const requestedPage = Number.parseInt(searchParams.get('page') || '1', 10)
    const requestedPageSize = Number.parseInt(searchParams.get('pageSize') || '50', 10)
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1
    // Compatibility endpoint only. Large list loads previously selected up to
    // 10,000 rows (including root rawData) and dominated network/database use.
    // New UI code should use /api/transactions/query with keyset cursors.
    const pageSize = Number.isFinite(requestedPageSize) && requestedPageSize > 0
      ? Math.min(requestedPageSize, 100)
      : 50
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') as TransactionStatus | null
    const type = searchParams.get('type') as TransactionType | null
    const source = searchParams.get('source') as TransactionSource | null
    const accountId = searchParams.get('accountId')
    const batchId = searchParams.get('batchId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    // Whitelist sortable columns to prevent ORM/SQL injection via arbitrary keys.
    const ALLOWED_SORT = new Set(['txDateTime', 'amount', 'status', 'source', 'type', 'createdAt', 'updatedAt'])
    const rawSortBy = searchParams.get('sortBy') || 'txDateTime'
    const sortBy = ALLOWED_SORT.has(rawSortBy) ? rawSortBy : 'txDateTime'
    const sortDir: 'asc' | 'desc' = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc'

    // Build where clause
    const where: Record<string, unknown> = {}

    // Role-based account filtering
    if (session.role === UserRole.ACCOUNT_MGR) {
      const access = await db.accountAccess.findMany({ where: { userId: session.userId } })
      const allowedIds = access.map((a: { accountId: string }) => a.accountId)
      where.accountId = { in: allowedIds }
    } else if (accountId) {
      where.accountId = accountId
    }

    if (status) where.status = status
    if (type) where.type = type
    if (source) where.source = source
    if (batchId) where.batchId = batchId
    const currency = searchParams.get('currency')
    if (currency) where.currency = currency
    // Manual review filters
    const reviewed = searchParams.get('reviewed')
    if (reviewed === 'true') where.reviewCategory = { not: null }
    else if (reviewed === 'false') where.reviewCategory = null
    const reviewCategory = searchParams.get('reviewCategory')
    if (reviewCategory) where.reviewCategory = reviewCategory
    if (dateFrom || dateTo) {
      where.txDateTime = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59') } : {}),
      }
    }
    if (search) {
      where.OR = [
        { shamCashTxId: { contains: search, mode: 'insensitive' } },
        { platformTxId: { contains: search, mode: 'insensitive' } },
        { platformUserId: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Duplicate ShamCash detection — find every shamCashTxId that
    // participates in more than ONE matched pair. A normal matched
    // pair always has 2 rows with the same shamCashTxId (the field is
    // copied to the counterpart on link), so naïvely grouping by
    // shamCashTxId reports every matched pair as a "duplicate" — that
    // produced the 109K false positive count.
    //
    // The right predicate is "the SC number appears in more than one
    // distinct matched group". We canonicalize each row to its pair-id
    // (= the lesser of its own id and its matchedTxId, falling back to
    // the row's own id when un-paired) and count distinct pair-ids per
    // shamCashTxId. > 1 means the SC number spans multiple pairs.
    const wantDuplicatesOnly = searchParams.get('duplicates') === '1'
    const duplicateScSet = new Set<string>()
    // This aggregation is intentionally opt-in. Running it for every normal
    // list request forces a full scan/sort of the multi-million-row table.
    if (wantDuplicatesOnly) {
      type DupRow = { shamCashTxId: string }
      const dupRows = await db.$queryRaw<DupRow[]>`
        SELECT "shamCashTxId"
        FROM transactions
        WHERE "shamCashTxId" IS NOT NULL
          AND status::text IN ('MATCHED', 'DISCREPANCY')
        GROUP BY "shamCashTxId"
        HAVING COUNT(DISTINCT LEAST("id", COALESCE("matchedTxId", "id"))) > 1
      `
      for (const row of dupRows) {
        if (row.shamCashTxId) duplicateScSet.add(row.shamCashTxId)
      }
    }

    if (wantDuplicatesOnly) {
      if (duplicateScSet.size === 0) {
        // Short-circuit: no duplicate groups → empty result, no further query.
        return NextResponse.json({
          success: true,
          data: [],
          meta: { total: 0, page, pageSize, totalPages: 0, duplicateScCount: 0 },
        })
      }
      where.shamCashTxId = { in: Array.from(duplicateScSet) }
    }

    // Deduplicate matched pairs in the reconciliation view: only show the SC
    // side when no source is requested. Skip the dedup when (a) scoping by
    // `batchId` (upload-history drill-down) — there the user wants to see
    // *every* row that came in with the batch, including the PLATFORM side
    // of matched pairs, (b) the user is searching — both sides of the
    // matched pair must be findable, and (c) when listing duplicates —
    // hiding the platform side would mask the actual duplicate cluster.
    if (!source && !batchId && !search && !wantDuplicatesOnly) {
      where.NOT = {
        AND: [
          { status: TransactionStatus.MATCHED },
          { source: TransactionSource.PLATFORM },
        ],
      }
    }

    // Sort: when ?duplicates=1 is active, group rows by shamCashTxId
    // first so every cluster of repeats appears together. Falls back to
    // the user's selected sort within the cluster.
    const effectiveOrderBy: Array<Record<string, 'asc' | 'desc'>> = wantDuplicatesOnly
      ? [{ shamCashTxId: 'asc' }, { txDateTime: 'asc' }]
      : [{ [sortBy]: sortDir }]

    // Opt-in `matchedTx.rawData` — the counterpart's Excel-row snapshot is
    // a large JSON blob that only /profits DetailModal actually renders.
    // /reconciliation doesn't need it, and pageSize=10000 lists were
    // dominating network transfer (~5.5 GB / 22 days on Neon Free).
    // Callers that need it pass `?includeMatchedRaw=1`.
    const includeMatchedRaw = searchParams.get('includeMatchedRaw') === '1'
    const matchedTxSelect = includeMatchedRaw
      ? { rawData: true, platformTxId: true, platformUserId: true, shamCashTxId: true, amount: true, source: true }
      : { platformTxId: true, platformUserId: true, shamCashTxId: true, amount: true, source: true }

    const [total, transactions] = await Promise.all([
      db.transaction.count({ where }),
      db.transaction.findMany({
        where,
        include: {
          account: { select: { name: true, currency: true } },
          matchedTx: { select: matchedTxSelect },
          // Module D — the employee inferred to have handled this operation.
          handledByUser: { select: { id: true, name: true } },
          // Trace each row back to its UploadBatch so the UI can render a
          // small "rosa" chip that deep-links to /upload-history.
          batch: {
            select: {
              id: true,
              batchDate: true,
              createdAt: true,
              uploader: { select: { name: true } },
            },
          },
        },
        orderBy: effectiveOrderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    // Mark every returned row with its duplicate-SC flag. The flag drives a
    // small red badge in the reconciliation table.
    const annotated = (transactions as Array<Record<string, unknown>>).map(t => ({
      ...t,
      hasDuplicateSc: typeof t.shamCashTxId === 'string' && duplicateScSet.has(t.shamCashTxId),
    }))

    return NextResponse.json({
      success: true,
      data: annotated,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        duplicateScCount: duplicateScSet.size,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

const updateSchema = z.object({
  id: z.string(),
  status: z.enum(['MATCHED', 'PENDING_SC', 'PENDING_P', 'DISCREPANCY', 'WASTE', 'RETURNS']).optional(),
  amount: z.number().positive().optional(),
  shamCashTxId: z.string().optional(),
  platformTxId: z.string().optional(),
  platformUserId: z.string().optional(),
  notes: z.string().optional(),
  reviewCategory: z.enum([
    'THEFT', 'WASTE', 'EXTRA', 'EMPLOYEE_ERROR', 'CUSTOMER_ERROR', 'PLATFORM_ERROR', 'COMPLAINT', 'INTERNAL_TRANSFER', 'OTHER', 'NONE',
  ]).optional(),
  reviewNotes: z.string().optional(),
})

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.ACCOUNT_MGR])

    const body = await req.json()
    const data = updateSchema.parse(body)

    const existing = await db.transaction.findUnique({ where: { id: data.id } })
    if (!existing) return NextResponse.json({ error: 'العملية غير موجودة' }, { status: 404 })

    const updateData: Record<string, unknown> = {}
    if (data.status !== undefined) updateData.status = data.status
    if (data.amount !== undefined) updateData.amount = data.amount
    if (data.shamCashTxId !== undefined) updateData.shamCashTxId = data.shamCashTxId
    if (data.platformTxId !== undefined) updateData.platformTxId = data.platformTxId
    if (data.platformUserId !== undefined) updateData.platformUserId = data.platformUserId
    if (data.notes !== undefined) {
      updateData.notes = data.notes
      // rawData itself remains immutable here. Recompute only the two compact
      // derived columns so a note edit (including the internal-transfer flag)
      // is reflected in future list and summary reads.
      try {
        const account = await db.account.findUnique({
          where: { id: existing.accountId },
          select: { walletIdentifiers: true },
        }) as { walletIdentifiers?: string[] } | null
        const derived = deriveTransactionFields(
          existing.rawData,
          account?.walletIdentifiers ?? [],
          data.notes,
        )
        updateData.customerName = derived.customerName
        updateData.isInternalTransferAuto = derived.isInternalTransferAuto
      } catch (deriveError) {
        // A transient derived-field lookup must not reject an otherwise valid
        // financial edit; the resumable backfill can reconcile it later.
        console.warn('Transaction derived-field recompute failed:', deriveError)
      }
    }

    // ── Review fields ──
    // reviewCategory === 'NONE' → clear all review fields (undo review) + clear follow-up
    // any other value → set category + reviewedBy = current user + reviewedAt = now;
    //                   auto-open a follow-up if the category is customer-facing
    //                   (COMPLAINT / CUSTOMER_ERROR / PLATFORM_ERROR) and none exists yet.
    let reviewAction: 'set' | 'clear' | null = null
    if (data.reviewCategory === 'NONE') {
      updateData.reviewCategory = null
      updateData.reviewNotes = null
      updateData.reviewedBy = null
      updateData.reviewedAt = null
      // The follow-up is owned by the review — undoing the review undoes its follow-up too.
      updateData.followUpStatus = null
      updateData.followUpAssignedTo = null
      updateData.followUpResolution = null
      updateData.followUpResolvedAt = null
      updateData.followUpResolvedBy = null
      reviewAction = 'clear'
    } else if (data.reviewCategory !== undefined) {
      updateData.reviewCategory = data.reviewCategory
      updateData.reviewedBy = session.userId
      updateData.reviewedAt = new Date()
      if (data.reviewNotes !== undefined) updateData.reviewNotes = data.reviewNotes
      const isCustomerFacing =
        data.reviewCategory === 'COMPLAINT' ||
        data.reviewCategory === 'CUSTOMER_ERROR' ||
        data.reviewCategory === 'PLATFORM_ERROR'
      const existingFollowUp = (existing as unknown as { followUpStatus?: string | null }).followUpStatus ?? null
      if (isCustomerFacing && !existingFollowUp) {
        updateData.followUpStatus = 'OPEN'
      }
      reviewAction = 'set'
    } else if (data.reviewNotes !== undefined) {
      // notes-only edit (already reviewed, changing explanation)
      updateData.reviewNotes = data.reviewNotes
    }

    const updated = await db.transaction.update({
      where: { id: data.id },
      data: updateData,
    })

    await audit(session.userId, 'UPDATE_TRANSACTION', 'Transaction', data.id, {
      before: { status: existing.status, amount: Number(existing.amount), shamCashTxId: existing.shamCashTxId, platformTxId: existing.platformTxId },
      after: updateData,
    })

    if (reviewAction) {
      await audit(session.userId, 'REVIEW_TRANSACTION', 'Transaction', data.id, {
        action: reviewAction,
        before: {
          reviewCategory: (existing as unknown as { reviewCategory?: string | null }).reviewCategory ?? null,
          reviewNotes: (existing as unknown as { reviewNotes?: string | null }).reviewNotes ?? null,
        },
        after: {
          reviewCategory: updateData.reviewCategory ?? null,
          reviewNotes: updateData.reviewNotes ?? null,
        },
      })
    }

    // ── Auto-match on edit (expanded) ──
    // Scenarios handled:
    //   A. PENDING rows gaining or changing a shamCashTxId / platformTxId →
    //      search both sides (by SC id AND by platform id) for an unlinked
    //      counterpart and link them (MATCHED or DISCREPANCY by amount).
    //   B. Already linked MATCHED/DISCREPANCY rows having their amount edited →
    //      recalculate amountDiff on BOTH sides and upgrade/downgrade the
    //      pair's status accordingly.
    let autoMatchResult: Record<string, unknown> | null = null
    try {
      const current = updated

      // ─── Scenario B: already linked — propagate amount/recompute diff ───
      const amountChanged = data.amount !== undefined && Number(data.amount) !== Number(existing.amount)
      if (current.matchedTxId && amountChanged) {
        const counterpart = await db.transaction.findUnique({ where: { id: current.matchedTxId } })
        if (counterpart && sameCurrency(current.currency, counterpart.currency)) {
          const a = Number(current.amount)
          const b = Number(counterpart.amount)
          const diff = Math.abs(a - b)
          const isExact = diff < 0.01
          await db.transaction.update({
            where: { id: current.id },
            data: {
              status: isExact ? TransactionStatus.MATCHED : TransactionStatus.DISCREPANCY,
              amountDiff: isExact ? null : diff,
            },
          })
          await db.transaction.update({
            where: { id: counterpart.id },
            data: {
              status: isExact ? TransactionStatus.MATCHED : TransactionStatus.DISCREPANCY,
              amountDiff: isExact ? null : diff,
            },
          })
          await audit(session.userId, 'AUTO_RECOMPUTE_ON_EDIT', 'Transaction', current.id, {
            counterpartId: counterpart.id,
            amountA: a, amountB: b, amountDiff: diff,
            status: isExact ? 'MATCHED' : 'DISCREPANCY',
          })
          autoMatchResult = {
            propagated: true, matched: isExact, counterpartId: counterpart.id, amountDiff: diff,
          }
        }
      }

      // ─── Scenario A: unlinked row gaining/changing a linking ID ───
      if (!current.matchedTxId &&
          (current.status === TransactionStatus.PENDING_P || current.status === TransactionStatus.PENDING_SC)) {
        const scChanged = data.shamCashTxId !== undefined && data.shamCashTxId !== existing.shamCashTxId && !!current.shamCashTxId
        const platformChanged = data.platformTxId !== undefined && data.platformTxId !== existing.platformTxId && !!current.platformTxId
        // Pick which field to use for the search (prefer the one just edited)
        const searchFilters: Record<string, string>[] = []
        if (scChanged && current.shamCashTxId) searchFilters.push({ shamCashTxId: current.shamCashTxId })
        if (platformChanged && current.platformTxId) searchFilters.push({ platformTxId: current.platformTxId })

        // Counterpart should be on the OPPOSITE status (and ideally opposite source,
        // but we don't enforce source — platforms sometimes have shamCashTxId too).
        const counterpartStatus =
          current.status === TransactionStatus.PENDING_P
            ? TransactionStatus.PENDING_SC
            : TransactionStatus.PENDING_P

        let counterpart: Awaited<ReturnType<typeof db.transaction.findFirst>> = null
        for (const f of searchFilters) {
          counterpart = await db.transaction.findFirst({
            where: {
              ...f,
              accountId: current.accountId,
              type: current.type,
              currency: current.currency,
              status: counterpartStatus,
              matchedTxId: null,
              id: { not: current.id },
            },
          })
          if (counterpart) break
        }

        const needsMatch = scChanged ? 'BY_SC_ID' : platformChanged ? 'BY_P_ID' : null

        if (counterpart && needsMatch) {
          const amountA = Number(current.amount)
          const amountB = Number(counterpart.amount)
          const diff = Math.abs(amountA - amountB)
          const isExact = diff < 0.01

          if (isExact) {
            await db.$transaction([
              db.transaction.update({
                where: { id: current.id },
                data: {
                  status: TransactionStatus.MATCHED,
                  matchedTxId: counterpart.id,
                  // copy counterpart IDs for display on the SC-side row
                  ...(needsMatch === 'BY_P_ID' ? { platformUserId: counterpart.platformUserId } : {}),
                  notes: current.notes ? `${current.notes} | ربط يدوي` : '[ربط يدوي]',
                  amountDiff: null,
                },
              }),
              db.transaction.update({
                where: { id: counterpart.id },
                data: {
                  status: TransactionStatus.MATCHED,
                  matchedTxId: current.id,
                  // copy IDs onto counterpart for display parity
                  ...(needsMatch === 'BY_SC_ID' ? { shamCashTxId: current.shamCashTxId } : {}),
                  ...(needsMatch === 'BY_P_ID' ? { platformTxId: current.platformTxId } : {}),
                  notes: counterpart.notes ? `${counterpart.notes} | ربط يدوي` : '[ربط يدوي]',
                  amountDiff: null,
                },
              }),
            ])
            autoMatchResult = {
              linked: true, matched: true, counterpartId: counterpart.id, amountDiff: 0,
            }
          } else {
            await db.$transaction([
              db.transaction.update({
                where: { id: current.id },
                data: {
                  status: TransactionStatus.DISCREPANCY,
                  matchedTxId: counterpart.id,
                  amountDiff: diff,
                  notes: current.notes ? `${current.notes} | ربط يدوي - فارق` : '[ربط يدوي - فارق]',
                },
              }),
              db.transaction.update({
                where: { id: counterpart.id },
                data: {
                  status: TransactionStatus.DISCREPANCY,
                  matchedTxId: current.id,
                  amountDiff: diff,
                  ...(needsMatch === 'BY_SC_ID' ? { shamCashTxId: current.shamCashTxId } : {}),
                  ...(needsMatch === 'BY_P_ID' ? { platformTxId: current.platformTxId } : {}),
                  notes: counterpart.notes ? `${counterpart.notes} | ربط يدوي - فارق` : '[ربط يدوي - فارق]',
                },
              }),
            ])
            autoMatchResult = {
              linked: true, matched: false, counterpartId: counterpart.id, amountDiff: diff,
            }
          }

          await audit(session.userId, 'AUTO_MATCH_ON_EDIT', 'Transaction', current.id, {
            counterpartId: counterpart.id,
            via: needsMatch,
            amountA, amountB, amountDiff: diff,
            status: isExact ? 'MATCHED' : 'DISCREPANCY',
          })

          // Soft-warn when the linking SC number is already part of an
          // OTHER matched pair (within the same account). The user asked
          // for a flag-and-continue, not a hard block — the UI surfaces
          // this as a toast with a link to the existing match(es).
          if (current.shamCashTxId) {
            const others = await db.transaction.findMany({
              where: {
                shamCashTxId: current.shamCashTxId,
                accountId: current.accountId,
                status: { in: [TransactionStatus.MATCHED, TransactionStatus.DISCREPANCY] },
                id: { notIn: [current.id, counterpart.id] },
              },
              select: { id: true, txDateTime: true, platformTxId: true, source: true },
              take: 5,
            })
            if (others.length > 0) {
              autoMatchResult = {
                ...(autoMatchResult ?? {}),
                duplicateScWarning: {
                  shamCashTxId: current.shamCashTxId,
                  existingMatches: others,
                },
              }
            }
          }
        }
      }
    } catch (e) {
      // Auto-match is best-effort — don't break the main PUT response
      console.error('Auto-match on edit failed:', e)
    }

    // Refresh the additive summaries from both identities: `existing` covers
    // groups the row may have left, while `updated` covers its new groups.
    // This is deliberately best-effort so a summary refresh problem never
    // rolls back an already-committed financial edit.
    try {
      await syncTransactionReadModels([existing, updated])
    } catch (readModelError) {
      console.warn('Transaction read-model sync failed:', readModelError)
    }

    // All direct and auto-match writes are complete before invalidating the
    // short-lived financial/customer/duplicate read caches. Cache failure must
    // never turn a successfully committed financial edit into a 500.
    try { invalidateFinancialReadModels() } catch (cacheError) { console.warn('Read-model cache invalidation failed:', cacheError) }
    return NextResponse.json({ success: true, data: updated, autoMatch: autoMatchResult })
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    // ADMIN gets this via ROLE_DEFAULT_PERMISSIONS (ALL_PERMISSIONS); non-admins
    // must be explicitly granted via /permissions (PermissionOverride).
    const denial = await requireCapability(session, PERMISSIONS.TRANSACTIONS_DELETE)
    if (denial) return denial

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'معرف العملية مطلوب' }, { status: 400 })

    const existing = await db.transaction.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'العملية غير موجودة' }, { status: 404 })

    await db.transaction.delete({ where: { id } })

    await audit(session.userId, 'DELETE_TRANSACTION', 'Transaction', id, {
      status: existing.status,
      amount: Number(existing.amount),
      type: existing.type,
    })

    try {
      await syncTransactionReadModels([existing])
    } catch (readModelError) {
      console.warn('Transaction read-model sync failed:', readModelError)
    }
    try { invalidateFinancialReadModels() } catch (cacheError) { console.warn('Read-model cache invalidation failed:', cacheError) }
    return NextResponse.json({ success: true, message: 'تم حذف العملية' })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
