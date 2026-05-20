import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'

// Per-user UI preferences (currently: table column order).
// GET   → the caller's uiPreferences JSON ({} if none).
// PATCH → shallow-merge the body into uiPreferences; `tableColumns` is merged
//         per-tableId so saving one table's order never drops another's.

export const dynamic = 'force-dynamic'

type Prefs = {
  tableColumns?: Record<string, string[]>
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

  await db.user.update({
    where: { id: session.userId },
    data: { uiPreferences: merged },
  })
  return NextResponse.json({ success: true, data: merged })
}
