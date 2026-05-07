import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (session.role !== UserRole.ADMIN) return NextResponse.json({ error: 'المدير فقط' }, { status: 403 })

  const q = req.nextUrl.searchParams.get('q')?.trim() || ''
  const accountId = req.nextUrl.searchParams.get('accountId')?.trim() || ''
  const dateFrom = req.nextUrl.searchParams.get('dateFrom')
  const dateTo = req.nextUrl.searchParams.get('dateTo')

  const where: Record<string, unknown> = { action: 'CONSOLIDATE_PAIR' }
  if (dateFrom || dateTo) {
    const range: Record<string, Date> = {}
    if (dateFrom) range.gte = new Date(dateFrom)
    if (dateTo) range.lte = new Date(dateTo + 'T23:59:59')
    where.createdAt = range
  }

  const logs = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 5000,
    include: { user: { select: { name: true, email: true } } },
  })

  // Optional filter by accountId or free-text search (name/amount/number)
  const filtered = logs.filter((l: any) => {
    const d = (l.details || {}) as Record<string, unknown>
    if (accountId && d.accountId !== accountId) return false
    if (!q) return true
    const hay = JSON.stringify(d).toLowerCase()
    return hay.includes(q.toLowerCase())
  })

  return NextResponse.json({ success: true, data: filtered })
}

// DELETE: remove consolidation log entries.
// Body: { ids?: string[], all?: boolean }
//   - ids: delete specific entries by their audit log id
//   - all: true → delete ALL CONSOLIDATE_PAIR entries (use with care)
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (session.role !== UserRole.ADMIN) return NextResponse.json({ error: 'المدير فقط' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map((x: unknown) => String(x)) : []
  const all = body.all === true

  let where: Record<string, unknown>
  if (all) {
    where = { action: 'CONSOLIDATE_PAIR' }
  } else if (ids.length > 0) {
    where = { action: 'CONSOLIDATE_PAIR', id: { in: ids } }
  } else {
    return NextResponse.json({ error: 'يجب تحديد ids أو all=true' }, { status: 400 })
  }

  const result = await db.auditLog.deleteMany({ where })
  return NextResponse.json({ success: true, deleted: result.count })
}

