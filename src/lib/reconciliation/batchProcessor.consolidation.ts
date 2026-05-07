import { consolidatePendingSC } from '@/lib/reconciliation/consolidate'
import { linkTransactionsToEmployees } from '@/lib/reconciliation/employeeLinker'

// Auto-consolidate PENDING_SC operations by net (deposits - withdrawals) per account.
export async function runAutoConsolidation(
  accountId: string,
  uploadedBy: string,
  batchId: string,
  summary: Record<string, number>,
): Promise<void> {
  try {
    const consolidationResult = await consolidatePendingSC(accountId, uploadedBy, batchId)
    summary.consolidatedGroups = consolidationResult.consolidatedGroups
    summary.consolidatedRemoved = consolidationResult.removedTransactions
  } catch (e) {
    console.error('Auto-consolidation failed:', e)
  }
}

// Module D: link this batch's transactions to the employees who handled them
export async function runEmployeeLinking(
  batchId: string,
  summary: Record<string, number>,
): Promise<void> {
  try {
    const linkResult = await linkTransactionsToEmployees({ batchId, onlyUnlinked: true })
    summary.employeesLinked = linkResult.linked
    summary.employeesAmbiguous = linkResult.ambiguous
    summary.employeesUnlinked = linkResult.unlinked
  } catch (e) {
    console.error('Employee linking failed (non-fatal):', e)
  }
}
