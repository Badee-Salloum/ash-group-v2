// Per-user notifications feed: list (with unread count) + delete a single one.

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json(
        { error: 'غير مصرح' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
      )
    }

    const requestedLimit = Number.parseInt(req.nextUrl.searchParams.get('limit') || '50', 10)
    const take = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 50)
      : 50

    const [data, unreadCount] = await Promise.all([
      db.notification.findMany({
        where: { userId: session.userId },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      db.notification.count({
        where: { userId: session.userId, readAt: null },
      }),
    ])

    return NextResponse.json(
      { success: true, data, unreadCount },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id مطلوب' }, { status: 400 })

    const existing = await db.notification.findUnique({
      where: { id },
      select: { id: true, userId: true },
    })
    if (!existing) return NextResponse.json({ error: 'الإشعار غير موجود' }, { status: 404 })
    if (existing.userId !== session.userId) {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
    }

    await db.notification.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
