import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole, TransactionStatus, TransactionSource, TransactionType } from '@/lib/db/prisma-types'
import { isOpsBearer } from '@/lib/auth/opsToken'
import { damascusDayStartUtc, addDays } from '@/lib/datetime'

// Bulk-classify SC-only withdrawals that have no platform counterpart.
//
// Some SC "ارسال" rows genuinely have no matching platform payout order — the
// money left Sham Cash without a corresponding platform withdrawal record.
// They sit as PENDING_SC forever and clutter the "needs review" queue. This
// endpoint stamps a reviewCategory + note on them in bulk so they leave the
// queue documented rather than silently ignored.
//
// STRICT targeting — only rows that are ALL of:
//   * source SHAM_CASH, type WITHDRAWAL, status PENDING_SC
//   * matchedTxId IS NULL      (never touch a linked pair)
//   * reviewCategory IS NULL   (never overwrite a human's classification)
//   * txDateTime within the requested Damascus-day window
//
// dryRun defaults to TRUE: you must pass dryRun:false explicitly to write.
//
// POST /api/admin/bulk-classify-sc-only
// { accountId, from, to, reviewCategory, reviewNotes?, dryRun? }
export const maxDuration = 120

const REVIEW_CATEGORIES = [
  'THEFT', 'WASTE', 'EXTRA', 'EMPLOYEE_ERROR', 'CUSTOMER_ERROR',
  'PLATFORM_ERROR', 'COMPLAINT', 'INTERNAL_TRANSFER', 'OTHER',
] as const

const bodySchema = z.object({
  accountId: z.string().min(1).optional(),
  accountName: z.string().min(1).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
  reviewCategory: z.enum(REVIEW_CATEGORIES),
  reviewNotes: z.string().max(500).optional(),
  // 'internal' -> only rows the ingest pipeline tagged notes='internal-transfer'
  // 'external' -> only rows without that tag (genuine customer payouts)
  // 'any'      -> both (default)
  notesFilter: z.enum(['internal', 'external', 'any']).default('any'),
  // By default only virgin rows are touched. Pass an explicit category here to
  // re-classify rows that already carry it — used to correct a prior sweep.
  overwriteCategory: z.enum(REVIEW_CATEGORIES).optional(),
  dryRun: z.boolean().default(true),
}).refine(b => !!b.accountId || !!b.accountName, {
  message: 'accountId or accountName is required',
})

export async function POST(req: NextRequest) {
  try {
    let actorId = 'ops'
    if (!isOpsBearer(req)) {
      const session = await getSession()
      if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
      requireRole(session, [UserRole.ADMIN])
      actorId = session.userId
    } else {
      // AuditLog.userId is a real FK — attribute machine calls to the oldest
      // active ADMIN, same convention as the Bearer upload path.
      const admin = await db.user.findFirst({
        where: { role: UserRole.ADMIN, isActive: true },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      })
      if (!admin) return NextResponse.json({ error: 'no admin user to attribute action' }, { status: 500 })
      actorId = admin.id
    }

    const body = bodySchema.parse(await req.json())

    let accountId = body.accountId
    if (!accountId && body.accountName) {
      const acc = await db.account.findFirst({
        where: { name: { contains: body.accountName, mode: 'insensitive' } },
        select: { id: true },
      })
      if (!acc) return NextResponse.json({ error: 'الحساب غير موجود' }, { status: 404 })
      accountId = acc.id
    }

    const where = {
      accountId,
      source: TransactionSource.SHAM_CASH,
      type: TransactionType.WITHDRAWAL,
      status: TransactionStatus.PENDING_SC,
      matchedTxId: null,
      // Virgin rows by default; overwriteCategory narrows to rows already
      // carrying that exact category, so a mistaken sweep can be corrected
      // without touching anything a human classified differently.
      reviewCategory: body.overwriteCategory ?? null,
      ...(body.notesFilter === 'internal' ? { notes: 'internal-transfer' } : {}),
      ...(body.notesFilter === 'external' ? { NOT: { notes: 'internal-transfer' } } : {}),
      txDateTime: {
        gte: damascusDayStartUtc(body.from),
        lt: damascusDayStartUtc(addDays(body.to, 1)),
      },
    }

    const targets = await db.transaction.findMany({
      where,
      select: { id: true, shamCashTxId: true, amount: true, currency: true, txDateTime: true },
      orderBy: { txDateTime: 'asc' },
    })

    const sample: Array<{
      id: string; shamCashTxId: string | null; amount: number; currency: string; txDateTime: Date
    }> = targets.slice(0, 10).map((t: {
      id: string; shamCashTxId: string | null; amount: unknown; currency: string; txDateTime: Date
    }) => ({
      id: t.id,
      shamCashTxId: t.shamCashTxId,
      amount: Number(t.amount),
      currency: t.currency,
      txDateTime: t.txDateTime,
    }))
    const totalAmount = targets.reduce(
      (s: number, t: { amount: unknown }) => s + Number(t.amount || 0), 0,
    )

    if (body.dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        wouldClassify: targets.length,
        totalAmount: Math.round(totalAmount * 100) / 100,
        reviewCategory: body.reviewCategory,
        notesFilter: body.notesFilter,
        overwriteCategory: body.overwriteCategory ?? null,
        window: { from: body.from, to: body.to },
        sample,
      })
    }

    if (targets.length === 0) {
      return NextResponse.json({
        ok: true, dryRun: false, classified: 0,
        window: { from: body.from, to: body.to },
      })
    }

    const res = await db.transaction.updateMany({
      where,
      data: {
        reviewCategory: body.reviewCategory,
        reviewNotes: body.reviewNotes ?? null,
        reviewedBy: actorId,
        reviewedAt: new Date(),
      },
    })

    await audit(actorId, 'BULK_CLASSIFY_SC_ONLY', 'Transaction', null as unknown as string, {
      accountId,
      window: { from: body.from, to: body.to },
      reviewCategory: body.reviewCategory,
      notesFilter: body.notesFilter,
      overwriteCategory: body.overwriteCategory ?? null,
      reviewNotes: body.reviewNotes ?? null,
      classified: res.count,
      totalAmount: Math.round(totalAmount * 100) / 100,
      sampleTxIds: sample.map(s => s.shamCashTxId),
    })

    return NextResponse.json({
      ok: true,
      dryRun: false,
      classified: res.count,
      totalAmount: Math.round(totalAmount * 100) / 100,
      reviewCategory: body.reviewCategory,
      notesFilter: body.notesFilter,
      overwriteCategory: body.overwriteCategory ?? null,
      window: { from: body.from, to: body.to },
      sample,
    })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    if (e instanceof Error && e.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 })
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
