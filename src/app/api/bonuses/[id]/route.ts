import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

// PATCH /api/bonuses/[id]
//
// Edits an existing BonusLog row (amount and/or reason). Same guards as the
// DELETE handler on /api/bonuses: refuse when the bonus's week has already
// been PAID via PayrollEntry — that snapshot is finalized.
//
// Side-effect: when the amount changes and a DRAFT/CONFIRMED PayrollEntry
// exists for the same (userId, weekStart), bump that entry's
// bonusAmount + netAmount by the delta so the payroll stays in sync without
// requiring a re-run of POST /api/payroll. PAID entries are never touched.
//
// CUMULATIVE bonuses are special — they're computed live by
// computeCumulativeBonus and the stored logs are informational. The UI hides
// the edit affordance for them; if a client still tries, we let the PATCH go
// through (the live computation will simply override at next read), but we
// don't run the payroll-sync side-effect.
//
// Audited as UPDATE_BONUS with before/after values.

const patchSchema = z.object({
  amount: z.number().positive().optional(),
  reason: z.string().nullable().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const body = await req.json()
    const parsed = patchSchema.parse(body)
    if (parsed.amount == null && parsed.reason === undefined) {
      return NextResponse.json({ error: 'لا توجد حقول للتحديث' }, { status: 400 })
    }

    const existing = await db.bonusLog.findUnique({ where: { id: params.id } })
    if (!existing) {
      return NextResponse.json({ error: 'المكافأة غير موجودة' }, { status: 404 })
    }

    // Refuse when the payroll snapshot for this bonus's week is already PAID.
    if (existing.weekStart) {
      const paidEntry = await db.payrollEntry.findFirst({
        where: { userId: existing.userId, weekStart: existing.weekStart, status: 'PAID' },
        select: { id: true },
      })
      if (paidEntry) {
        return NextResponse.json(
          { error: 'لا يمكن تعديل مكافأة مدفوعة (الراتب لهذا الأسبوع مدفوع بالفعل).' },
          { status: 403 },
        )
      }
    }

    const oldAmount = Number(existing.amount)
    const newAmount = parsed.amount ?? oldAmount
    const delta = newAmount - oldAmount

    await db.bonusLog.update({
      where: { id: params.id },
      data: {
        ...(parsed.amount != null ? { amount: parsed.amount } : {}),
        ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
      },
    })

    // Sync the DRAFT/CONFIRMED PayrollEntry for the same week — bumps both
    // bonusAmount and netAmount by the delta. We skip this for CUMULATIVE
    // bonuses (they're live-computed by the payroll route, no row to sync)
    // and for PAID entries (already screened above).
    if (delta !== 0 && existing.weekStart && existing.type !== 'CUMULATIVE') {
      const entry = await db.payrollEntry.findFirst({
        where: { userId: existing.userId, weekStart: existing.weekStart, status: { in: ['DRAFT', 'CONFIRMED'] } },
        select: { id: true, bonusAmount: true, netAmount: true },
      })
      if (entry) {
        await db.payrollEntry.update({
          where: { id: entry.id },
          data: {
            bonusAmount: Number(entry.bonusAmount) + delta,
            netAmount: Number(entry.netAmount) + delta,
          },
        })
      }
    }

    await audit(session.userId, 'UPDATE_BONUS', 'BonusLog', params.id, {
      userId: existing.userId,
      type: existing.type,
      before: { amount: oldAmount, reason: existing.reason },
      after: { amount: newAmount, reason: parsed.reason !== undefined ? parsed.reason : existing.reason },
    })

    return NextResponse.json({ success: true })
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
