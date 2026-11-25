import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { z } from 'zod'

// Auto-generate leave groups for a shift. Algorithm:
//   K = ceil(N / 7)              → number of groups AND spares (each group
//                                   has one cover picked from the spares).
//   membersInGroups = N − K
//   distribute:                    base = floor(members/K); rest = members % K
//                                  `rest` groups get base+1 members, the
//                                  remainder get base. Max ≤ 6.
//
// Examples (matches the user's earlier spec):
//   9  → K=2, members=7  → [4, 3]           + 2 spares
//   12 → K=2, members=10 → [5, 5]           + 2 spares
//   14 → K=2, members=12 → [6, 6]           + 2 spares
//   16 → K=3, members=13 → [5, 4, 4]        + 3 spares
//
// Employee-to-role mapping is deterministic (sort by name → first K are
// spares, rest distributed). Manager tweaks afterwards.

const GROUP_NAMES = [
  'المجموعة A', 'المجموعة B', 'المجموعة C', 'المجموعة D', 'المجموعة E', 'المجموعة F',
  'المجموعة G', 'المجموعة H', 'المجموعة I', 'المجموعة J',
]

const bodySchema = z.object({
  shiftNumber: z.enum(['ONE', 'TWO', 'THREE']),
  // When true, existing LeaveGroups for this shift are dissolved first
  // (their members become spares). Defaults to true — the auto-gen is
  // supposed to replace, not append.
  replace: z.boolean().optional().default(true),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.MANAGER])

    const { shiftNumber, replace } = bodySchema.parse(await req.json())

    // Employees active in this shift over the last 30 days (from Shift
    // rows). Fall back to "any active EMPLOYEE" if the roster has never
    // been populated for that shift yet.
    const since = new Date(Date.now() - 30 * 86_400_000)
    const shiftRows = await db.shift.findMany({
      where: { shiftNumber, date: { gte: since } },
      select: { userId: true },
    })
    const rosterIds = Array.from(new Set((shiftRows as Array<{ userId: string }>).map(r => r.userId)))

    const employees = await db.user.findMany({
      where: {
        isActive: true,
        role: 'EMPLOYEE',
        ...(rosterIds.length > 0 ? { id: { in: rosterIds } } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    type Emp = { id: string; name: string }
    const roster = employees as Emp[]
    const N = roster.length

    if (N < 2) {
      return NextResponse.json({
        error: N === 0
          ? 'لا يوجد موظفون في هذه النوبة لتوليد مجموعات.'
          : 'يجب أن يكون هناك موظفان على الأقل (واحد سبير + عضو واحد).',
      }, { status: 400 })
    }

    const K = Math.max(1, Math.ceil(N / 7))
    const spares = roster.slice(0, K)
    const membersPool = roster.slice(K)
    const membersCount = membersPool.length
    const base = Math.floor(membersCount / K)
    const rest = membersCount % K

    // Split membersPool into K contiguous chunks (larger chunks first).
    const chunks: Emp[][] = []
    let cursor = 0
    for (let i = 0; i < K; i++) {
      const size = i < rest ? base + 1 : base
      chunks.push(membersPool.slice(cursor, cursor + size))
      cursor += size
    }

    // Everything happens in one transaction so a partial failure leaves
    // no half-built groups behind.
    const created = await db.$transaction(async (tx: typeof db) => {
      if (replace) {
        // Detach current members, then delete the groups.
        const existing = await tx.leaveGroup.findMany({
          where: { shiftNumber },
          select: { id: true },
        })
        const ids = (existing as Array<{ id: string }>).map(g => g.id)
        if (ids.length > 0) {
          await tx.user.updateMany({ where: { leaveGroupId: { in: ids } }, data: { leaveGroupId: null } })
          await tx.leaveGroup.deleteMany({ where: { id: { in: ids } } })
        }
      }

      const groupIds: string[] = []
      for (let i = 0; i < K; i++) {
        const name = GROUP_NAMES[i] ?? `المجموعة ${i + 1}`
        const g = await tx.leaveGroup.create({
          data: {
            name,
            shiftNumber,
            coverUserId: spares[i].id,
          },
          select: { id: true },
        })
        groupIds.push(g.id)
        const memberIds = chunks[i].map(m => m.id)
        if (memberIds.length > 0) {
          await tx.user.updateMany({
            where: { id: { in: memberIds } },
            data: { leaveGroupId: g.id },
          })
        }
      }
      return groupIds
    })

    await audit(session.userId, 'AUTO_GENERATE_LEAVE_GROUPS', 'LeaveGroup', undefined, {
      shiftNumber,
      employees: N,
      groups: K,
      spares: K,
      distribution: chunks.map(c => c.length),
      replace,
    })

    return NextResponse.json({
      success: true,
      created: created.length,
      spares: K,
      distribution: chunks.map(c => c.length),
      totalEmployees: N,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
