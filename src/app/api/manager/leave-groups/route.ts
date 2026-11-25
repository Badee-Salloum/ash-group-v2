import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

// Snapshot for /schedule → مجموعات الإجازات section. Returns the
// existing LeaveGroups (grouped by shiftNumber) plus, for each shift,
// the list of "spares" — active EMPLOYEE users assigned to that shift
// in the last 30 days but not currently members of any LeaveGroup.
export async function GET(_req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  requireRole(session, [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPERVISOR])

  const since = new Date(Date.now() - 30 * 86_400_000)

  const [groupsRaw, shiftRows, allEmployees] = await Promise.all([
    db.leaveGroup.findMany({
      include: {
        members: {
          select: { id: true, name: true, employeeCode: true, weeklyOffDay: true },
          orderBy: { name: 'asc' },
        },
        coverUser: { select: { id: true, name: true, employeeCode: true } },
      },
      orderBy: [{ shiftNumber: 'asc' }, { name: 'asc' }],
    }),
    // Every Shift row in the last 30 days — we use it to figure out which
    // employees have been on which shift-number recently, so the UI can
    // list them as "spare candidates" per shift.
    db.shift.findMany({
      where: { date: { gte: since } },
      select: { userId: true, shiftNumber: true },
    }),
    db.user.findMany({
      where: { isActive: true, role: 'EMPLOYEE' },
      select: { id: true, name: true, employeeCode: true, weeklyOffDay: true, leaveGroupId: true },
      orderBy: { name: 'asc' },
    }),
  ])

  type ShiftRow = { userId: string; shiftNumber: 'ONE' | 'TWO' | 'THREE' }
  type EmpRow = { id: string; name: string; employeeCode: string | null; weeklyOffDay: number | null; leaveGroupId: string | null }
  type GroupRow = typeof groupsRaw[number]

  // Bucket employees per shift by their most recent shift assignments.
  const shiftByUser = new Map<string, Set<'ONE' | 'TWO' | 'THREE'>>()
  for (const r of shiftRows as ShiftRow[]) {
    const set = shiftByUser.get(r.userId) ?? new Set()
    set.add(r.shiftNumber)
    shiftByUser.set(r.userId, set)
  }

  const perShift: Record<'ONE' | 'TWO' | 'THREE', { groups: GroupRow[]; spares: EmpRow[] }> = {
    ONE: { groups: [], spares: [] },
    TWO: { groups: [], spares: [] },
    THREE: { groups: [], spares: [] },
  }

  for (const g of groupsRaw as GroupRow[]) {
    perShift[g.shiftNumber as 'ONE' | 'TWO' | 'THREE'].groups.push(g)
  }

  // Spares = employees active in shift N in the last 30 days AND without a
  // leaveGroupId. If they have no shift history yet, they still appear in
  // every shift's spare list so the manager can drop them into any group.
  for (const emp of allEmployees as EmpRow[]) {
    if (emp.leaveGroupId) continue
    const shifts = shiftByUser.get(emp.id)
    if (!shifts || shifts.size === 0) {
      // "unrostered" — show in every shift for placement flexibility.
      perShift.ONE.spares.push(emp)
      perShift.TWO.spares.push(emp)
      perShift.THREE.spares.push(emp)
    } else {
      for (const sn of shifts) perShift[sn].spares.push(emp)
    }
  }

  return NextResponse.json({
    success: true,
    perShift: {
      ONE: { groups: perShift.ONE.groups, spares: perShift.ONE.spares },
      TWO: { groups: perShift.TWO.groups, spares: perShift.TWO.spares },
      THREE: { groups: perShift.THREE.groups, spares: perShift.THREE.spares },
    },
  })
}
