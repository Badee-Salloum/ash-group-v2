import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { computeCumulativeBonusBatch } from '@/lib/compensation/cumulativeBonus'

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const result = new Date(d)
  result.setDate(result.getDate() - day)
  result.setHours(0, 0, 0, 0)
  return result
}

type BonusLogRow = {
  id: string
  userId: string
  type: string
  amount: unknown
  reason: string | null
  appliedAt: Date
  weekStart: Date | null
  createdBy: { id: string; name: string } | null
}

/**
 * Bonus dashboard with a bounded query count. The previous implementation
 * executed several reads per employee and another read per bonus row; this
 * version reads each data set once and assembles employee rows in memory.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const params = req.nextUrl.searchParams
    const from = params.get('from') ? new Date(params.get('from')!) : new Date(Date.now() - 30 * 86_400_000)
    const to = params.get('to') ? new Date(params.get('to')!) : new Date()
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      return NextResponse.json({ error: 'نطاق التاريخ غير صالح' }, { status: 400 })
    }
    from.setHours(0, 0, 0, 0)
    to.setHours(23, 59, 59, 999)

    const employees = await db.user.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, jobTitle: true, employeeCode: true, avatarUrl: true,
        hireDate: true, createdAt: true, baseSalary: true, role: true,
      },
      orderBy: { name: 'asc' },
    })
    const employeeIds = employees.map((employee: { id: string }) => employee.id)
    const weekStart = startOfWeek(new Date())

    const [cumulativeByUser, bonusRows, errorRows] = await Promise.all([
      computeCumulativeBonusBatch(
        employees.map((employee: typeof employees[number]) => ({
          id: employee.id,
          hireDate: employee.hireDate ?? null,
          createdAt: employee.createdAt,
          role: employee.role,
          baseSalary: employee.baseSalary != null ? Number(employee.baseSalary) : null,
        })),
        weekStart,
        { includeAnchorWeek: false },
      ),
      employeeIds.length === 0 ? Promise.resolve([]) : db.bonusLog.findMany({
        where: {
          userId: { in: employeeIds },
          type: { in: ['GROUP', 'MANUAL'] },
          appliedAt: { gte: from, lte: to },
        },
        include: { createdBy: { select: { id: true, name: true } } },
        orderBy: { appliedAt: 'desc' },
      }),
      employeeIds.length === 0 ? Promise.resolve([]) : db.transaction.groupBy({
        by: ['handledByUserId'],
        where: {
          handledByUserId: { in: employeeIds },
          txDateTime: { gte: from, lte: to },
          reviewCategory: { in: ['EMPLOYEE_ERROR', 'THEFT'] },
        },
        _count: { _all: true },
      }),
    ])

    const allBonusRows = bonusRows as BonusLogRow[]
    const payrollWeeks = Array.from(new Set(
      allBonusRows
        .filter(row => row.weekStart)
        .map(row => `${row.userId}|${row.weekStart!.toISOString().slice(0, 10)}`),
    ))
    const paidRows = payrollWeeks.length === 0 ? [] : await db.payrollEntry.findMany({
      where: {
        status: 'PAID',
        OR: payrollWeeks.map(key => {
          const [userId, iso] = key.split('|')
          return { userId, weekStart: new Date(`${iso}T00:00:00.000Z`) }
        }),
      },
      select: { userId: true, weekStart: true },
    })
    const paidSet = new Set(
      (paidRows as Array<{ userId: string; weekStart: Date }>).map(row => `${row.userId}|${row.weekStart.toISOString().slice(0, 10)}`),
    )

    const bonusByUser = new Map<string, BonusLogRow[]>()
    for (const row of allBonusRows) {
      const list = bonusByUser.get(row.userId) || []
      list.push(row)
      bonusByUser.set(row.userId, list)
    }
    const errorsByUser = new Map<string, number>()
    for (const row of errorRows as Array<{ handledByUserId: string | null; _count: { _all: number } }>) {
      if (row.handledByUserId) errorsByUser.set(row.handledByUserId, row._count._all)
    }
    type EmployeeRow = {
      id: string
      name: string
      employeeCode: string | null
    }
    const employeeById = new Map<string, EmployeeRow>(
      employees.map((employee: typeof employees[number]) => [
        employee.id,
        { id: employee.id, name: employee.name, employeeCode: employee.employeeCode },
      ]),
    )

    const rows = employees.map((employee: typeof employees[number]) => {
      const cumulative = cumulativeByUser.get(employee.id) || { cleanStreak: 0, amount: 0, lastErrorWeek: null }
      const bonuses = bonusByUser.get(employee.id) || []
      let groupAmount = 0
      let manualAmount = 0
      for (const bonus of bonuses) {
        if (bonus.type === 'GROUP') groupAmount += Number(bonus.amount || 0)
        else if (bonus.type === 'MANUAL') manualAmount += Number(bonus.amount || 0)
      }

      return {
        id: employee.id,
        name: employee.name,
        jobTitle: employee.jobTitle,
        employeeCode: employee.employeeCode,
        avatarUrl: employee.avatarUrl,
        baseSalary: employee.baseSalary != null ? Number(employee.baseSalary) : null,
        cumulativeAmount: cumulative.amount,
        cumulativeWeeks: cumulative.cleanStreak,
        lastErrorWeek: cumulative.lastErrorWeek?.toISOString() || null,
        groupAmount,
        manualAmount,
        manualBonusCount: bonuses.length,
        total: cumulative.amount + groupAmount + manualAmount,
        periodErrors: errorsByUser.get(employee.id) || 0,
        bonuses: bonuses.map(bonus => ({
          id: bonus.id,
          type: bonus.type,
          amount: Number(bonus.amount || 0),
          reason: bonus.reason,
          appliedAt: bonus.appliedAt,
          weekStart: bonus.weekStart,
          createdBy: bonus.createdBy,
          isPaid: bonus.weekStart
            ? paidSet.has(`${bonus.userId}|${bonus.weekStart.toISOString().slice(0, 10)}`)
            : false,
        })),
      }
    })

    const recent = allBonusRows.slice(0, 20).map(bonus => {
      const employee = employeeById.get(bonus.userId)
      return {
        id: bonus.id,
        type: bonus.type,
        amount: Number(bonus.amount || 0),
        reason: bonus.reason,
        appliedAt: bonus.appliedAt,
        user: employee ? { id: employee.id, name: employee.name, employeeCode: employee.employeeCode } : null,
        createdBy: bonus.createdBy,
        isPaid: bonus.weekStart
          ? paidSet.has(`${bonus.userId}|${bonus.weekStart.toISOString().slice(0, 10)}`)
          : false,
      }
    })

    return NextResponse.json({
      success: true,
      from: from.toISOString(),
      to: to.toISOString(),
      employees: rows,
      recent,
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
