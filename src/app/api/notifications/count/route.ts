import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json(
        { error: 'غير مصرح' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
      )
    }

    const unreadCount = await db.notification.count({
      where: { userId: session.userId, readAt: null },
    })

    return NextResponse.json(
      { success: true, unreadCount },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch {
    return NextResponse.json(
      { error: 'تعذر تحميل عدد الإشعارات' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }
}
