// Mark a batch (or all) of the current user's notifications as read.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'

const schema = z.object({
  markAllAsRead: z.boolean().optional(),
  ids: z.array(z.string()).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const data = schema.parse(await req.json().catch(() => ({})))
    if (!data.markAllAsRead && (!data.ids || data.ids.length === 0)) {
      return NextResponse.json({ error: 'حدد markAllAsRead أو ids' }, { status: 400 })
    }

    const where: Record<string, unknown> = {
      userId: session.userId,
      readAt: null,
    }
    if (!data.markAllAsRead && data.ids && data.ids.length > 0) {
      where.id = { in: data.ids }
    }

    const result = await db.notification.updateMany({
      where,
      data: { readAt: new Date() },
    })

    return NextResponse.json({ success: true, updated: result.count })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.issues[0]?.message || 'بيانات غير صالحة' }, { status: 400 })
    }
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
