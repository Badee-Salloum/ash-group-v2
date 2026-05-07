import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { audit } from '@/lib/auth'

// Weekly auto-payroll cron — invoked by Vercel Cron at the start of every week.
// Configured via vercel.json. Only callable from Vercel (CRON_SECRET header) or
// when running with no secret set.
//
// What it does:
//   For each active employee with a baseSalary, generate (or refresh) the
//   payroll entry for the previous full week — same logic as POST /api/payroll.

const FIRST_DAY_OF_WEEK = parseInt(process.env.WEEK_START_DAY || '0', 10) // 0=Sunday … 6=Saturday

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const diff = (day - FIRST_DAY_OF_WEEK + 7) % 7
  const m = new Date(d)
  m.setDate(d.getDate() - diff)
  m.setHours(0, 0, 0, 0)
  return m
}
function endOfWeek(d: Date): Date {
  const e = new Date(startOfWeek(d))
  e.setDate(e.getDate() + 6)
  e.setHours(23, 59, 59, 999)
  return e
}

export async function GET(req: NextRequest) {
  // Vercel cron sends a Bearer token if CRON_SECRET is set — accept either
  // (a) request from Vercel cron, OR (b) any request when no secret configured.
  const auth = req.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Generate for the just-completed week (today minus 7 days)
  const lastWeekDate = new Date(Date.now() - 7 * 86400000)
  const ws = startOfWeek(lastWeekDate)
  const we = endOfWeek(ws)

  const employees = await db.user.findMany({
    where: { isActive: true, baseSalary: { not: null } },
    select: { id: true, baseSalary: true },
  })

  let created = 0, refreshed = 0
  for (const emp of employees) {
    const sessions = await db.shiftSession.findMany({
      where: { userId: emp.id, status: 'COMPLETED', startAt: { gte: ws }, endAt: { lte: we } },
      select: { durationMinutes: true },
    })
    const workedMinutes = sessions.reduce((s: number, x: typeof sessions[0]) => s + (x.durationMinutes || 0), 0)
    const workedHours = workedMinutes / 60

    const cumulativeBonus = await db.bonusLog.aggregate({
      where: { userId: emp.id, weekStart: ws, type: 'CUMULATIVE' },
      _sum: { amount: true },
    })
    const otherBonuses = await db.bonusLog.aggregate({
      where: { userId: emp.id, weekStart: ws, type: { in: ['GROUP', 'MANUAL'] } },
      _sum: { amount: true },
    })
    const bonusAmount = Number(cumulativeBonus._sum.amount || 0) + Number(otherBonuses._sum.amount || 0)

    const advances = await db.advanceRequest.findMany({
      where: { userId: emp.id, status: 'APPROVED', payrollEntryId: null },
    })
    const advanceAmount = advances.reduce((s: number, a: typeof advances[0]) => s + Number(a.amount), 0)

    const baseSalary = Number(emp.baseSalary || 0)
    const expectedHours = 40
    const proRated = expectedHours > 0 ? (baseSalary * (workedHours / expectedHours)) : baseSalary
    const netAmount = proRated + bonusAmount - advanceAmount

    const existing = await db.payrollEntry.findUnique({
      where: { userId_weekStart: { userId: emp.id, weekStart: ws } },
    })
    if (existing) {
      await db.payrollEntry.update({
        where: { id: existing.id },
        data: { workedHours, bonusAmount, advanceAmount, netAmount },
      })
      refreshed++
    } else {
      const entry = await db.payrollEntry.create({
        data: {
          userId: emp.id,
          weekStart: ws,
          weekEnd: we,
          baseSalary,
          workedHours,
          expectedHours,
          bonusAmount,
          advanceAmount,
          deductions: 0,
          netAmount,
          status: 'DRAFT',
        },
      })
      if (advances.length > 0) {
        await db.advanceRequest.updateMany({
          where: { id: { in: advances.map((a: typeof advances[0]) => a.id) } },
          data: { payrollEntryId: entry.id, status: 'PAID' },
        })
      }
      created++
    }
  }

  // Cumulative bonuses are now LIVE-computed in /api/payroll GET — no cron
  // accrual needed. The cron just snapshots PayrollEntry rows for the
  // just-completed week so historical reporting has stable rows.

  await audit('system', 'CRON_GENERATE_PAYROLL', 'PayrollEntry', null as unknown as string, {
    weekStart: ws, weekEnd: we, created, refreshed, firstDayOfWeek: FIRST_DAY_OF_WEEK,
  })

  return NextResponse.json({ success: true, weekStart: ws.toISOString(), created, refreshed })
}
