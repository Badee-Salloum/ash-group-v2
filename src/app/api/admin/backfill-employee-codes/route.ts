import { NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { nextCodeForPrefix, prefixForRole } from '@/lib/employees/codeGenerator'

// POST /api/admin/backfill-employee-codes
//
// One-shot maintenance endpoint: assigns the per-role employee-code prefix
// to every active user that doesn't already have one.
//
// Codes that ALREADY exist are NEVER overwritten — losing a printed/known
// identifier is worse than tolerating a stale prefix from before the
// per-role scheme.
//
// Auth: ADMIN only.
// Returns: { backfilled, byRole: { ADMIN: n, MANAGER: n, ... } }.

export async function POST() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    const targets = await db.user.findMany({
      where: { employeeCode: null, isActive: true },
      select: { id: true, role: true, name: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    })

    // Pre-fetch the current max per prefix so we can hand out sequential
    // codes within a single batch without a DB round-trip per user.
    const prefixes: string[] = Array.from(
      new Set(targets.map((u: { role: string }) => prefixForRole(u.role))),
    )
    const nextNum = new Map<string, number>()
    for (const p of prefixes) {
      const seed = await nextCodeForPrefix(p)
      nextNum.set(p, parseInt(seed.replace(`${p}-`, ''), 10))
    }

    const byRole: Record<string, number> = {}
    let total = 0
    for (const u of targets as Array<{ id: string; role: string; name: string }>) {
      const prefix = prefixForRole(u.role)
      const num = nextNum.get(prefix)!
      const code = `${prefix}-${String(num).padStart(4, '0')}`
      try {
        await db.user.update({
          where: { id: u.id },
          data: { employeeCode: code },
        })
        nextNum.set(prefix, num + 1)
        byRole[u.role] = (byRole[u.role] || 0) + 1
        total++
      } catch (err) {
        // If a unique-constraint collision happens (someone else just took
        // the code), bump and retry once.
        const retryCode = `${prefix}-${String(num + 1).padStart(4, '0')}`
        try {
          await db.user.update({
            where: { id: u.id },
            data: { employeeCode: retryCode },
          })
          nextNum.set(prefix, num + 2)
          byRole[u.role] = (byRole[u.role] || 0) + 1
          total++
        } catch {
          // give up on this row silently — the next backfill call will pick it up
          void err
        }
      }
    }

    await audit(session.userId, 'BACKFILL_EMPLOYEE_CODES', 'User', null as unknown as string, {
      backfilled: total,
      byRole,
    })

    return NextResponse.json({
      success: true,
      backfilled: total,
      byRole,
      total: targets.length,
    })
  } catch (e) {
    if (e instanceof Error && e.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 })
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
