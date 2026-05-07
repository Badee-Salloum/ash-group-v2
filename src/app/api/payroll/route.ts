import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { getDefaultWeeklyOffDays } from '@/lib/settings/global'
import { z } from 'zod'

// Module G — Weekly payroll.
// GET ?weekStart=YYYY-MM-DD → list payroll entries for that week
// POST { weekStart, weekEnd } → generate (or refresh) payroll for all active employees
// PATCH { id, ... } → manual adjustment (deductions, bonus override, mark paid)

// First day of the working week, configurable per deployment.
// 0 = Sunday (default — Syrian work week), 1 = Monday, 6 = Saturday, etc.
const FIRST_DAY_OF_WEEK = parseInt(process.env.WEEK_START_DAY || '0', 10)

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

// LIVE payroll computation. Run on every page load — there is no manual
// "generate" step for the current week. Salary is per-DAY-worked:
//
//   workingDaysInWeek    = 7 − weeklyOffDays (default 6)
//   dailyRate            = baseSalary / workingDaysInWeek
//   daysWorked           = number of distinct calendar days within the period
//                          on which the employee had at least one shift session
//                          (clamped to days since hireDate)
//   proRated             = dailyRate × daysWorked
//   net                  = proRated + bonuses − deductions
//
// Two modes:
//   1) ?weekStart=YYYY-MM-DD → single week (default if no params)
//   2) ?from=YYYY-MM-DD&to=YYYY-MM-DD → arbitrary range (aggregated, live only —
//      no PAID snapshots respected; status always DRAFT for range mode)
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const fromParam = params.get('from')
  const toParam = params.get('to')
  const isRangeMode = !!(fromParam && toParam)

  let ws: Date, we: Date
  if (isRangeMode) {
    ws = new Date(fromParam!); ws.setHours(0, 0, 0, 0)
    we = new Date(toParam!); we.setHours(23, 59, 59, 999)
  } else {
    const weekStart = params.get('weekStart') ? new Date(params.get('weekStart')!) : startOfWeek(new Date())
    ws = startOfWeek(weekStart)
    we = endOfWeek(weekStart)
  }

  // 1. All active employees. Those without a baseSalary still appear so their
  // bonuses (cumulative + group + manual) are visible — only the salary
  // portion is zero.
  const employees = await db.user.findMany({
    where: { isActive: true },
    select: {
      id: true, name: true, jobTitle: true, employeeCode: true, avatarUrl: true,
      baseSalary: true, hireDate: true, createdAt: true,
    },
    orderBy: { name: 'asc' },
  })

  // 2. Fetch any PRE-EXISTING entries for this period (paid snapshots, edits)
  // — only relevant in single-week mode. Range mode is always live/draft.
  const existingEntries = isRangeMode
    ? []
    : await db.payrollEntry.findMany({ where: { weekStart: ws } })
  type ExistingEntry = typeof existingEntries[0]
  const byUser = new Map<string, ExistingEntry>()
  for (const e of existingEntries) byUser.set(e.userId, e)

  // Single global default — admins set this in /settings (not per-employee).
  const offDays = await getDefaultWeeklyOffDays()
  const workingDaysPerWeek = Math.max(1, 7 - offDays)

  const out: Array<Record<string, unknown>> = []
  for (const emp of employees) {
    const baseSalary = Number(emp.baseSalary || 0)
    const dailyRate = baseSalary / workingDaysPerWeek

    // Count distinct DAYS the employee had a completed session inside this week
    const sessions = await db.shiftSession.findMany({
      where: {
        userId: emp.id,
        status: { in: ['COMPLETED', 'ACTIVE', 'PENDING_END'] },
        startAt: { gte: ws, lte: we },
      },
      select: { startAt: true, endAt: true },
    })
    const daySet = new Set<string>()
    for (const s of sessions) {
      // anchor on local date (yyyy-mm-dd)
      const k = new Date(s.startAt).toISOString().slice(0, 10)
      daySet.add(k)
    }
    let daysWorked = daySet.size

    // Cap days-worked by hireDate window (e.g. employee started mid-week)
    if (emp.hireDate) {
      const hire = new Date(emp.hireDate); hire.setHours(0, 0, 0, 0)
      if (hire > ws) {
        // available working days between hireDate and end of week
        const msPerDay = 86_400_000
        const availDays = Math.max(0, Math.floor((we.getTime() - hire.getTime()) / msPerDay) + 1)
        daysWorked = Math.min(daysWorked, availDays)
      }
    }

    // 3a. GROUP/MANUAL bonuses for this period (these are explicitly added)
    const bonusWhere = isRangeMode
      ? { userId: emp.id, weekStart: { gte: ws, lte: we } }
      : { userId: emp.id, weekStart: ws }
    const others = await db.bonusLog.aggregate({
      where: { ...bonusWhere, type: { in: ['GROUP', 'MANUAL'] } },
      _sum: { amount: true },
    })

    // 3b. CUMULATIVE bonus — computed LIVE based on the employee's recent
    // error-free streak. Walks back week-by-week, counting clean weeks
    // until an error week OR the employee's start boundary is reached.
    // Boundary = hireDate when set, otherwise createdAt of the user record
    // (so brand-new employees without hireDate don't get phantom history).
    const CUMULATIVE_PER_WEEK = 5000
    const MAX_LOOKBACK_WEEKS = 24
    const startBoundary = emp.hireDate
      ? new Date(emp.hireDate)
      : (emp.createdAt ? new Date(emp.createdAt) : null)
    if (startBoundary) startBoundary.setHours(0, 0, 0, 0)
    const hireBoundary = startBoundary
    let cleanStreak = 0
    for (let w = 1; w <= MAX_LOOKBACK_WEEKS; w++) {
      const wsBack = new Date(ws); wsBack.setDate(ws.getDate() - 7 * w)
      if (hireBoundary && wsBack < hireBoundary) break
      const weBack = new Date(wsBack); weBack.setDate(wsBack.getDate() + 7)
      const errCount = await db.transaction.count({
        where: {
          handledByUserId: emp.id,
          txDateTime: { gte: wsBack, lt: weBack },
          reviewCategory: { in: ['EMPLOYEE_ERROR', 'THEFT'] },
        },
      })
      if (errCount > 0) break
      cleanStreak++
    }
    const cumulativeAmount = cleanStreak * CUMULATIVE_PER_WEEK
    const bonusFromLogs = Number(others._sum.amount || 0) + cumulativeAmount

    // 4. Merge with persisted entry (if any). PAID entries are frozen.
    const persisted = byUser.get(emp.id)
    const isPaid = persisted?.status === 'PAID'

    const proRated = dailyRate * daysWorked
    const liveBonus = isPaid ? Number(persisted!.bonusAmount) : (persisted ? Number(persisted.bonusAmount) || bonusFromLogs : bonusFromLogs)
    const liveDeductions = persisted ? Number(persisted.deductions) : 0
    const liveProRated = isPaid ? Number(persisted!.baseSalary) * (Number(persisted!.workedHours) / Math.max(1, Number(persisted!.expectedHours))) : proRated
    const netAmount = isPaid ? Number(persisted!.netAmount) : (liveProRated + liveBonus - liveDeductions)

    out.push({
      id: persisted?.id || `live-${emp.id}-${ws.toISOString().slice(0,10)}`,
      userId: emp.id,
      user: { ...emp, baseSalary: emp.baseSalary != null ? Number(emp.baseSalary) : null },
      weekStart: ws.toISOString(),
      weekEnd: we.toISOString(),
      baseSalary,
      // Re-purposed for daily display: store days-worked in workedHours, and
      // working-days-per-period in expectedHours.
      workedHours: daysWorked,
      expectedHours: isRangeMode
        ? Math.max(1, Math.ceil((we.getTime() - ws.getTime()) / 86_400_000) + 1) - Math.floor(((we.getTime() - ws.getTime()) / 86_400_000 + 1) / 7) * offDays
        : workingDaysPerWeek,
      dailyRate,
      bonusAmount: liveBonus,
      advanceAmount: 0,
      deductions: liveDeductions,
      netAmount,
      status: persisted?.status || 'DRAFT',
      paidAt: persisted?.paidAt ?? null,
      notes: persisted?.notes ?? null,
      isLive: !persisted,
    })
  }

  return NextResponse.json({
    success: true,
    weekStart: ws.toISOString(),
    weekEnd: we.toISOString(),
    computedAt: new Date().toISOString(),
    data: out,
  })
}

const generateSchema = z.object({
  weekStart: z.string(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const body = await req.json()
    const { weekStart } = generateSchema.parse(body)
    const ws = startOfWeek(new Date(weekStart))
    const we = endOfWeek(ws)

    // Get all active employees with a base salary
    const employees = await db.user.findMany({
      where: { isActive: true, baseSalary: { not: null } },
      select: { id: true, baseSalary: true },
    })

    let created = 0, refreshed = 0
    for (const emp of employees) {
      // Compute worked hours from shift sessions in this week
      const sessions = await db.shiftSession.findMany({
        where: {
          userId: emp.id,
          status: 'COMPLETED',
          startAt: { gte: ws },
          endAt: { lte: we },
        },
        select: { durationMinutes: true },
      })
      const workedMinutes = sessions.reduce((s: number, x: typeof sessions[0]) => s + (x.durationMinutes || 0), 0)
      const workedHours = workedMinutes / 60

      // Cumulative bonus auto-calc (Module I): base = sum of CUMULATIVE bonuses applied to this week
      const cumulativeBonus = await db.bonusLog.aggregate({
        where: { userId: emp.id, weekStart: ws, type: 'CUMULATIVE' },
        _sum: { amount: true },
      })
      // Group/manual bonuses for this week
      const otherBonuses = await db.bonusLog.aggregate({
        where: { userId: emp.id, weekStart: ws, type: { in: ['GROUP', 'MANUAL'] } },
        _sum: { amount: true },
      })
      const bonusAmount = Number(cumulativeBonus._sum.amount || 0) + Number(otherBonuses._sum.amount || 0)

      // Pending advances → APPROVED ones become PAID upon payroll generation
      const advances = await db.advanceRequest.findMany({
        where: { userId: emp.id, status: 'APPROVED', payrollEntryId: null },
      })
      const advanceAmount = advances.reduce((s: number, a: typeof advances[0]) => s + Number(a.amount), 0)

      const baseSalary = Number(emp.baseSalary || 0)
      const expectedHours = 40 // could be configurable per employee
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
        // Link advances to this entry & mark paid
        if (advances.length > 0) {
          await db.advanceRequest.updateMany({
            where: { id: { in: advances.map((a: typeof advances[0]) => a.id) } },
            data: { payrollEntryId: entry.id, status: 'PAID' },
          })
        }
        created++
      }
    }

    await audit(session.userId, 'GENERATE_PAYROLL', 'PayrollEntry', null as unknown as string, {
      weekStart: ws, created, refreshed,
    })
    return NextResponse.json({ success: true, created, refreshed })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

const patchSchema = z.object({
  id: z.string(),
  bonusAmount: z.number().optional(),
  deductions: z.number().optional(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'PAID']).optional(),
  notes: z.string().optional(),
})

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const body = await req.json()
    const { id, ...rest } = patchSchema.parse(body)

    // Live ids look like `live-<userId>-<YYYY-MM-DD>` and represent a
    // computed-on-the-fly payroll for an employee who doesn't have a saved
    // entry yet. Materialize one before mutating.
    let existing = await db.payrollEntry.findUnique({ where: { id } })
    if (!existing && id.startsWith('live-')) {
      const m = id.match(/^live-(.+)-(\d{4}-\d{2}-\d{2})$/)
      if (m) {
        const liveUserId = m[1]
        const liveWs = new Date(m[2] + 'T00:00:00Z')
        const liveWe = endOfWeek(liveWs)
        const emp = await db.user.findUnique({
          where: { id: liveUserId },
          select: { baseSalary: true },
        })
        const baseSalary = emp?.baseSalary != null ? Number(emp.baseSalary) : 0
        const offDays = await getDefaultWeeklyOffDays()
        const workingDays = Math.max(1, 7 - offDays)
        const sessions = await db.shiftSession.findMany({
          where: { userId: liveUserId, status: { in: ['COMPLETED', 'ACTIVE', 'PENDING_END'] }, startAt: { gte: liveWs, lte: liveWe } },
          select: { startAt: true },
        })
        const daySet = new Set<string>()
        for (const s of sessions) daySet.add(new Date(s.startAt).toISOString().slice(0, 10))
        const daysWorked = daySet.size

        existing = await db.payrollEntry.create({
          data: {
            userId: liveUserId,
            weekStart: liveWs,
            weekEnd: liveWe,
            baseSalary,
            workedHours: daysWorked,
            expectedHours: workingDays,
            bonusAmount: 0,
            advanceAmount: 0,
            deductions: 0,
            netAmount: (baseSalary / workingDays) * daysWorked,
            status: 'DRAFT',
          },
        })
      }
    }
    if (!existing) return NextResponse.json({ error: 'السجل غير موجود' }, { status: 404 })

    // Recompute net if bonus/deductions changed (null-safe coercions)
    const baseSalary = existing.baseSalary != null ? Number(existing.baseSalary) : 0
    const workedHours = existing.workedHours != null ? Number(existing.workedHours) : 0
    const expectedHours = existing.expectedHours != null ? Number(existing.expectedHours) : 0
    const advanceAmount = existing.advanceAmount != null ? Number(existing.advanceAmount) : 0
    const bonusAmount = rest.bonusAmount ?? (existing.bonusAmount != null ? Number(existing.bonusAmount) : 0)
    const deductions = rest.deductions ?? (existing.deductions != null ? Number(existing.deductions) : 0)
    const proRated = expectedHours > 0 ? baseSalary * (workedHours / expectedHours) : baseSalary
    const netAmount = proRated + bonusAmount - advanceAmount - deductions

    const updateData: Record<string, unknown> = { bonusAmount, deductions, netAmount }
    if (rest.status) {
      updateData.status = rest.status
      if (rest.status === 'PAID') updateData.paidAt = new Date()
    }
    if (rest.notes !== undefined) updateData.notes = rest.notes

    // Use existing.id (may have changed if we just materialized a live entry)
    await db.payrollEntry.update({ where: { id: existing.id }, data: updateData })

    // Auto-link to expenses: when status becomes PAID, create (or refresh) a
    // matching Expense so payroll outflows appear automatically in الصرفيات.
    // We use a deterministic description tag — payroll:<id> — to find the
    // existing expense without needing a new schema column.
    const becamePaid = rest.status === 'PAID'
    const alreadyPaidAmountChange = existing.status === 'PAID' && (rest.bonusAmount !== undefined || rest.deductions !== undefined)
    if (becamePaid || alreadyPaidAmountChange) {
      const empUser = await db.user.findUnique({
        where: { id: existing.userId },
        select: { name: true, employeeCode: true },
      })
      const wk = new Date(existing.weekStart).toISOString().slice(0, 10)
      const tag = `[payroll:${existing.id}]`
      const desc = `راتب ${empUser?.name || 'موظف'}${empUser?.employeeCode ? ` (${empUser.employeeCode})` : ''} — أسبوع ${wk} ${tag}`
      const linked = await db.expense.findFirst({
        where: { description: { contains: tag }, deletedAt: null },
      })
      if (linked) {
        await db.expense.update({
          where: { id: linked.id },
          data: { amount: netAmount, description: desc, category: 'رواتب' },
        })
      } else {
        await db.expense.create({
          data: {
            description: desc,
            amount: netAmount,
            category: 'رواتب',
            expenseDate: new Date(),
            userId: session.userId,
          },
        })
      }
    }

    await audit(session.userId, 'UPDATE_PAYROLL', 'PayrollEntry', id, rest)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
