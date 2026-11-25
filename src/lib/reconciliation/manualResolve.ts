import { db } from '@/lib/db/client'
import { audit } from '@/lib/auth'
import { UserRole, TransactionStatus } from '@/lib/db/prisma-types'
import { sameCurrency } from './currencyGuard'
import { syncTransactionReadModels } from '@/lib/performance/readModels'
import { invalidateFinancialReadModels } from '@/lib/performance/cache'

/** Shared validation for the legacy deposit / withdrawal resolution actions. */
export async function resolveManualPair(
  platformId: string, shamCashTxId: string, type: 'DEPOSIT' | 'WITHDRAWAL',
  session: { userId: string; role: string },
) {
  const platformTx = await db.transaction.findFirst({
    where: { id: platformId, source: 'PLATFORM', status: TransactionStatus.DISCREPANCY, type },
  })
  if (!platformTx) return { status: 404, body: { error: 'العملية غير موجودة أو ليست بحالة فارق' } }
  if (session.role === UserRole.ACCOUNT_MGR) {
    const access = await db.accountAccess.findFirst({ where: { userId: session.userId, accountId: platformTx.accountId } })
    if (!access) return { status: 403, body: { error: 'لا تملك صلاحية على الحساب' } }
  }
  const scTx = await db.transaction.findFirst({
    where: { shamCashTxId, accountId: platformTx.accountId, source: 'SHAM_CASH', status: TransactionStatus.PENDING_SC, type },
  })
  if (!scTx) return { status: 404, body: { error: 'عملية شام كاش غير موجودة في معلّقات الحساب نفسه' } }
  if (!sameCurrency(platformTx.currency, scTx.currency)) {
    return { status: 400, body: { error: 'لا يمكن مطابقة عمليتين بعملتين مختلفتين' } }
  }
  if (platformTx.matchedTxId || scTx.matchedTxId) {
    return { status: 409, body: { error: 'إحدى العمليتين مرتبطة بالفعل؛ فك الربط السابق أولاً' } }
  }
  const diff = Math.round(Math.abs(Number(platformTx.amount) - Number(scTx.amount)) * 100) / 100
  const status = diff === 0 ? TransactionStatus.MATCHED : TransactionStatus.DISCREPANCY
  const data = { status, amountDiff: diff === 0 ? null : diff }
  await db.$transaction([
    db.transaction.update({
      where: { id: platformTx.id, matchedTxId: null, status: TransactionStatus.DISCREPANCY },
      data: { ...data, matchedTxId: scTx.id },
    }),
    db.transaction.update({
      where: { id: scTx.id, matchedTxId: null, status: TransactionStatus.PENDING_SC },
      data: { ...data, matchedTxId: platformTx.id },
    }),
  ])
  await audit(session.userId, `MANUAL_RESOLVE_${type}`, 'Transaction', platformTx.id,
    { shamCashTxId, platformId, partnerId: scTx.id, currency: platformTx.currency, status })
  await syncTransactionReadModels([platformTx, scTx])
  invalidateFinancialReadModels()
  return { status: 200, body: { success: true, message: 'تم ربط العمليتين بنجاح', data: { status, amountDiff: diff } } }
}
