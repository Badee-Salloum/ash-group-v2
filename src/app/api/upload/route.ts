import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { processBatch } from '@/lib/reconciliation/batchProcessor'
import { opsAuthMethod } from '@/lib/auth/opsToken'
import { ImportValidationError } from '@/lib/parsers/validation'
import { withAuditContext } from '@/lib/audit/context'
import { createAttemptTracker } from '@/lib/uploads/attempts'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const authMethod = opsAuthMethod(req)
  const session = authMethod ? null : await getSession()
  if (!authMethod && !session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (session && !['ADMIN', 'SUPERVISOR'].includes(session.role)) return NextResponse.json({ error: 'غير مسموح' }, { status: 403 })
  const requested = req.headers.get('x-upload-attempt-id')
  const attemptId = requested && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requested) ? requested : crypto.randomUUID()
  const context = { actorType: authMethod ? 'SERVICE' as const : 'HUMAN' as const,
    authMethod: authMethod || 'SESSION' as const, actorUserId: session?.userId || null,
    requestId: crypto.randomUUID(), operationId: attemptId, reason: 'file_upload' }
  return withAuditContext(context, async () => {
    const tracker = createAttemptTracker(attemptId)
    // Deterministic attempt ID prevents a network retry from importing twice.
    try { await tracker.start() } catch (error) {
      const duplicate = (error as { code?: string })?.code === 'P2002'
      return NextResponse.json({ success: false, attemptId, error: duplicate
        ? 'هذه المحاولة مسجلة مسبقاً. تحقق من حالتها ولا تعاود إرسالها.'
        : 'تعذر تسجيل محاولة الرفع. لم تبدأ المعالجة.' }, { status: duplicate ? 409 : 503 })
    }
    try {
      let uploadedBy = session?.userId
      if (!uploadedBy) {
        const admin = await db.user.findFirst({ where: { role: 'ADMIN', isActive: true }, select: { id: true }, orderBy: { createdAt: 'asc' } })
        if (!admin) throw new Error('UPLOAD_OWNER_UNAVAILABLE')
        uploadedBy = admin.id
      }
      const form = await req.formData()
      const accountId = form.get('accountId')
      const files = ['shamCash', 'deposits', 'withdrawals'].map(key => form.get(key))
      if (typeof accountId !== 'string' || !accountId) throw new UploadInputError('الحساب مطلوب')
      if (!files.some(file => file instanceof File && file.size)) throw new UploadInputError('اختر ملفاً واحداً على الأقل')
      if (files.some(file => file instanceof File && file.size > 50 * 1024 * 1024)) throw new UploadInputError('حجم الملف يتجاوز 50MB')
      const account = await db.account.findUnique({ where: { id: accountId }, select: { id: true } })
      if (!account) throw new UploadInputError('الحساب غير موجود')
      const [shamCashBuffer, depositsBuffer, withdrawalsBuffer] = await Promise.all(files.map(async file =>
        file instanceof File && file.size ? Buffer.from(await file.arrayBuffer()) : undefined))
      await tracker.stage('RECEIVING', { accountId, attributedUploadOwnerId: authMethod ? uploadedBy : undefined })
      const result = await processBatch(accountId, { shamCashBuffer, depositsBuffer, withdrawalsBuffer }, uploadedBy!, tracker.stage)
      const warnings = Object.keys(result.summary).filter(key => key.endsWith('Warning') && result.summary[key] > 0)
      try { await tracker.stage('COMPLETED', { batchId: result.batchId, warnings }) }
      catch { console.error('Upload completed; tracking update unavailable', { attemptId }) }
      return NextResponse.json({ success: true, attemptId, ...result, warnings }, { headers: { 'Cache-Control': 'private, no-store' } })
    } catch (error) {
      const invalid = error instanceof ImportValidationError || error instanceof UploadInputError
      const errorCode = invalid ? 'INVALID_FILE' : 'PROCESSING_FAILED'
      // Never persist exception strings: drivers can include credentials or raw rows.
      try { await tracker.stage('FAILED', { errorCode }) } catch { console.error('Upload attempt status persistence failed', { attemptId }) }
      console.error('Upload failed', { attemptId, errorCode })
      return NextResponse.json({ success: false, attemptId, error: invalid ? error.message
        : 'تعذرت المعالجة. تحقق من سجل المحاولة قبل إعادة الرفع؛ قد توجد نتائج محفوظة.' }, { status: invalid ? 400 : 500 })
    }
  })
}
class UploadInputError extends Error {}

