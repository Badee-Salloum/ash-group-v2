import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'

// Per-user UI preferences (table column order + hide-matched toggles).
// GET   → the caller's uiPreferences JSON ({} if none).
// PATCH → shallow-merge the body into uiPreferences; `tableColumns` and
//         `hideMatched` are merged per-key so saving one slot never drops
//         the others.

export const dynamic = 'force-dynamic'

type Prefs = {
  tableColumns?: Record<string, string[]>
  // Default-hide MATCHED rows on /reconciliation and /customers/[name].
  // Absent keys are treated as `true` (hidden) by the consumers — this is
  // the user-requested default. Explicit `false` reveals MATCHED.
  hideMatched?: { reconciliation?: boolean; customers?: boolean }
  [k: string]: unknown
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { uiPreferences: true },
  })
  return NextResponse.json({ success: true, data: (user?.uiPreferences as Prefs) ?? {} })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Prefs
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { uiPreferences: true },
  })
  const current = ((user?.uiPreferences as Prefs) ?? {})
  const merged: Prefs = { ...current, ...body }
  if (body.tableColumns) {
    merged.tableColumns = { ...(current.tableColumns ?? {}), ...body.tableColumns }
  }
  if (body.hideMatched) {
    merged.hideMatched = { ...(current.hideMatched ?? {}), ...body.hideMatched }
  }

  await db.user.update({
    where: { id: session.userId },
    data: { uiPreferences: merged },
  })
  return NextResponse.json({ success: true, data: merged })
}
