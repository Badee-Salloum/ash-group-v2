import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { processBatch } from '@/lib/reconciliation/batchProcessor'
import { UserRole } from '@/lib/db/prisma-types'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN, UserRole.SUPERVISOR])

    const formData = await req.formData()
    const accountId = formData.get('accountId') as string
    const shamCashFile = formData.get('shamCash') as File
    const depositsFile = formData.get('deposits') as File
    const withdrawalsFile = formData.get('withdrawals') as File

    if (!accountId || !shamCashFile || !depositsFile || !withdrawalsFile) {
      return NextResponse.json({ error: 'جميع الملفات مطلوبة' }, { status: 400 })
    }

    // Validate file sizes (50MB)
    const maxBytes = 50 * 1024 * 1024
    for (const file of [shamCashFile, depositsFile, withdrawalsFile]) {
      if (file.size > maxBytes) {
        return NextResponse.json({ error: `الملف ${file.name} يتجاوز الحد المسموح (50MB)` }, { status: 400 })
      }
    }

    const [scBuffer, depBuffer, wdBuffer] = await Promise.all([
      shamCashFile.arrayBuffer().then(Buffer.from),
      depositsFile.arrayBuffer().then(Buffer.from),
      withdrawalsFile.arrayBuffer().then(Buffer.from),
    ])

    const result = await processBatch(
      accountId,
      { shamCashBuffer: scBuffer, depositsBuffer: depBuffer, withdrawalsBuffer: wdBuffer },
      session.userId
    )

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
