import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { UserRole } from '@/lib/db/prisma-types'
import { db } from '@/lib/db/client'
import { setPayrollEpochStart } from '@/lib/settings/global'

// Admin-only one-shot wipe of all payroll/bonus/expense/notification history
// strictly before `epochWeekStart`. After this call:
//   1. Every PayrollEntry whose weekStart < epoch is hard-deleted.
//   2. Every BonusLog whose weekStart < epoch is hard-deleted.
//   3. Every Expense tagged `[payroll:*]` whose expenseDate < epoch is
//      soft-deleted (deletedAt = now) — matches the normal payroll-unpay
//      cleanup path so audit history stays readable.
//   4. Every Notification of type PAYROLL_PAID / BONUS_RECEIVED /
//      DEDUCTION_APPLIED whose payload.weekStart < epoch is hard-deleted.
//   5. Any AdvanceRequest that referenced a now-deleted PayrollEntry is
//      reset (payrollEntryId nulled, status → APPROVED) so the request
//      itself isn't lost but is treated as not-yet-paid.
//   6. The global SystemSetting `payroll_epoch_start` is updated so the
//      cumulative-bonus walker enforces the new floor going forward.
//
// Caller must POST `{ epochWeekStart: 'YYYY-MM-DD', confirm: 'WIPE' }`.
// `epochWeekStart` must be a Sunday so it aligns with startOfWeek().
export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const body = await req.json().catch(() => ({}))
    const { epochWeekStart, confirm } = body as { epochWeekStart?: string; confirm?: string }
    if (!epochWeekStart || !/^\d{4}-\d{2}-\d{2}$/.test(epochWeekStart)) {
      return NextResponse.json({ error: 'epochWeekStart مطلوب بصيغة YYYY-MM-DD' }, { status: 400 })
    }
    if (confirm !== 'WIPE') {
      return NextResponse.json({ error: 'يجب تأكيد العملية بكتابة WIPE' }, { status: 400 })
    }
    const epochSunday = new Date(`${epochWeekStart}T00:00:00Z`)
    if (epochSunday.getUTCDay() !== 0) {
      return NextResponse.json({ error: 'epochWeekStart يجب أن يكون يوم أحد' }, { status: 400 })
    }

    // Use a Postgres-side DATE literal (matches text column for Notification
    // payload JSON, and Date columns for the others) — keep the string.
    const epochStr = epochWeekStart
    const epochDate = new Date(`${epochWeekStart}T00:00:00.000Z`)

    const result = await db.$transaction(async (tx: typeof db) => {
      // 1) Notifications — JSONB query via raw SQL. Stored payload.weekStart
      //    is YYYY-MM-DD (see createPayrollPaidNotification). Lexical < works
      //    because the format is fixed width.
      const notifDeleted = await tx.$executeRawUnsafe(
        `DELETE FROM notifications
         WHERE type IN ('PAYROLL_PAID','BONUS_RECEIVED','DEDUCTION_APPLIED')
           AND (payload->>'weekStart') IS NOT NULL
           AND substring(payload->>'weekStart' from 1 for 10) < $1`,
        epochStr,
      )

      // 2) Soft-delete Expenses tagged with the payroll tag.
      const expensesSoftDeleted = await tx.expense.updateMany({
        where: {
          description: { contains: '[payroll:' },
          expenseDate: { lt: epochDate },
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      })

      // 3) BonusLog — hard delete.
      const bonusLogsDeleted = await tx.bonusLog.deleteMany({
        where: { weekStart: { lt: epochDate } },
      })

      // 4) AdvanceRequest cleanup — break the FK before payroll deletion.
      //    Any advance pointing at a soon-to-be-deleted payroll gets its
      //    link cleared and (if PAID) is reverted to APPROVED so the
      //    request reappears as unpaid.
      const advancesReset = await tx.advanceRequest.updateMany({
        where: {
          payrollEntryId: { not: null },
          payrollEntry: { weekStart: { lt: epochDate } },
        },
        data: { payrollEntryId: null, status: 'APPROVED' },
      })

      // 5) PayrollEntry — hard delete.
      const payrollsDeleted = await tx.payrollEntry.deleteMany({
        where: { weekStart: { lt: epochDate } },
      })

      return {
        notifications: Number(notifDeleted),
        expensesSoftDeleted: expensesSoftDeleted.count,
        bonusLogs: bonusLogsDeleted.count,
        advancesReset: advancesReset.count,
        payrolls: payrollsDeleted.count,
      }
    })

    await setPayrollEpochStart(epochStr, session.userId)
    await audit(session.userId, 'PAYROLL_EPOCH_WIPE', 'SystemSetting', 'payroll_epoch_start', {
      epoch: epochStr,
      deleted: result,
    })

    return NextResponse.json({ success: true, epoch: epochStr, deleted: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
