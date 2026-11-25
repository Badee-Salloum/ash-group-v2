import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { opsAuthMethod } from '@/lib/auth/opsToken'
import { UPLOAD_STAGES } from '@/lib/uploads/attempts'

export const runtime = 'nodejs'
export async function GET(req: NextRequest) {
  const machine = opsAuthMethod(req)
  const session = machine ? null : await getSession()
  if (!machine && !session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (session && !['ADMIN', 'SUPERVISOR'].includes(session.role)) return NextResponse.json({ error: 'غير مسموح' }, { status: 403 })
  const id = req.nextUrl.searchParams.get('id')
  // Supervisors only see their own attempts; ADMIN may inspect all attempts.
  const where = { action: 'UPLOAD_ATTEMPT', ...(!machine && session?.role !== 'ADMIN' ? { userId: session?.userId } : {}) }
  const rows = await db.auditLog.findMany({ where: { ...where, ...(id ? { id } : { createdAt: { gte: new Date(Date.now() - 30 * 86400000) } }) },
    select: { id: true, createdAt: true, details: true, user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: id ? 1 : 30 })
  const data = rows.map((row: { id: string; createdAt: Date; details: Record<string, unknown>; user?: { name: string } | null }) => {
    const d = row.details || {}
    const stalled = d.status === 'PROCESSING' && Date.now() - new Date(row.createdAt).getTime() > 150000
    return { id: row.id, startedAt: d.startedAt, completedAt: d.completedAt, batchId: d.batchId,
      status: stalled ? 'INTERRUPTED' : d.status, stage: d.stage,
      stageLabel: d.status === 'COMPLETED' && Array.isArray(d.warnings) && d.warnings.length
        ? 'اكتمل الرفع مع تحذيرات؛ راجع المسؤول' : UPLOAD_STAGES[String(d.stage)] || '',
      actorType: d.actorType, authMethod: d.authMethod, actorUserId: d.actorUserId,
      actorName: row.user?.name || null, failedStageLabel: UPLOAD_STAGES[String(d.failedStage)] || null,
      elapsedMs: d.elapsedMs, errorCode: d.errorCode,
      stages: d.stages, warning: stalled ? 'لم يصل تأكيد نهائي. تحقق من الدفعة قبل إعادة الرفع.' : undefined }
  })
  return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, no-store' } })
}
