import { db } from '@/lib/db/client'
import { getAuditMetadata } from '@/lib/audit/context'

export const UPLOAD_STAGES: Record<string, string> = {
  RECEIVING: 'استلام الملفات', PARSING: 'قراءة الملفات والتحقق منها', MATCHING: 'تحديد مرشحي المطابقة',
  PERSISTING: 'حفظ العمليات والربط الآمن', HISTORICAL: 'مطابقة الأطراف المعلقة',
  CONSOLIDATING: 'التجميع', EMPLOYEES: 'إسناد الموظفين', SUMMARIES: 'تحديث الملخصات',
  COMPLETED: 'اكتملت المعالجة', FAILED: 'فشلت المعالجة — تحقق قبل إعادة الرفع',
}
export function createAttemptTracker(id: string) {
  const startedAt = new Date().toISOString()
  let details: Record<string, unknown> = { ...getAuditMetadata(), attemptId: id, startedAt, stage: 'RECEIVING',
    status: 'PROCESSING', stages: [{ stage: 'RECEIVING', at: startedAt }], reason: 'file_upload' }
  return {
    async start() {
      await db.auditLog.create({ data: { id, userId: getAuditMetadata().actorUserId,
        action: 'UPLOAD_ATTEMPT', entity: 'UploadAttempt', entityId: id, details } })
    },
    async stage(stage: string, extra: Record<string, unknown> = {}) {
      const now = new Date().toISOString()
      const stages = [...details.stages as Array<unknown>, { stage, at: now }]
      details = { ...details, ...extra, stage, stages,
        ...(stage === 'FAILED' ? { failedStage: details.stage } : {}),
        status: stage === 'COMPLETED' ? 'COMPLETED' : stage === 'FAILED' ? 'FAILED' : 'PROCESSING',
        elapsedMs: Date.now() - Date.parse(startedAt),
        ...(['COMPLETED', 'FAILED'].includes(stage) ? { completedAt: now, result: stage } : {}) }
      await db.auditLog.update({ where: { id }, data: { details } })
    },
  }
}
