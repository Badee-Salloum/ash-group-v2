import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { TransactionStatus, TransactionType, TransactionSource, UserRole } from '@/lib/db/prisma-types'
import { z } from 'zod'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '50'), 10000)
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') as TransactionStatus | null
    const type = searchParams.get('type') as TransactionType | null
    const source = searchParams.get('source') as TransactionSource | null
    const accountId = searchParams.get('accountId')
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

    // Deduplicate matched pairs: only show SC side (unless explicitly filtered by source)
    if (!source) {
      where.NOT = {
        AND: [
          { status: TransactionStatus.MATCHED },
          { source: TransactionSource.PLATFORM },
        ],
      }
    }

    const [total, transactions] = await Promise.all([
      db.transaction.count({ where }),
      db.transaction.findMany({
        where,
        include: {
          account: { select: { name: true, currency: true } },
          matchedTx: { select: { rawData: true, platformTxId: true, platformUserId: true, shamCashTxId: true, amount: true, source: true } },
        },
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return NextResponse.json({
      success: true,
      data: transactions,
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

const updateSchema = z.object({
  id: z.string(),
  status: z.enum(['MATCHED', 'PENDING_SC', 'PENDING_P', 'DISCREPANCY', 'WASTE']).optional(),
  amount: z.number().positive().optional(),
  shamCashTxId: z.string().optional(),
  platformTxId: z.string().optional(),
  platformUserId: z.string().optional(),
  notes: z.string().optional(),
  reviewCategory: z.enum([
    'THEFT', 'WASTE', 'EXTRA', 'EMPLOYEE_ERROR', 'CUSTOMER_ERROR', 'PLATFORM_ERROR', 'COMPLAINT', 'OTHER', 'NONE',
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
    if (data.notes !== undefined) updateData.notes = data.notes

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
        if (counterpart) {
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
        }
      }
    } catch (e) {
      // Auto-match is best-effort — don't break the main PUT response
      console.error('Auto-match on edit failed:', e)
    }

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
    requireRole(session, [UserRole.ADMIN])

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

    return NextResponse.json({ success: true, message: 'تم حذف العملية' })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
