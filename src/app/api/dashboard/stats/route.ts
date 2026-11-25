import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { decimal, getFinancialAggregates } from '@/lib/financial/aggregates'
import { CACHE_TAGS, cachedPrivateRead, estimateJsonBytes, requestMetricsHeaders } from '@/lib/performance/cache'

export async function GET() {
  const startedAt = performance.now()
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const allowed = new Set<string>([
      UserRole.ADMIN,
      UserRole.SUPERVISOR,
      UserRole.ACCOUNT_MGR,
      'ACCOUNTANT',
    ])
    if (!allowed.has(session.role)) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 })
    }

    // The account relation is loaded together with the account query below,
    // avoiding an extra accountAccess round-trip for restricted dashboards.
    // This cache remains user/role scoped and is invalidated whenever account
    // access or financial data changes.
    const scopeKey = `${session.role}:${session.userId}:dashboard-v2`

    const dbStartedAt = performance.now()
    const data = await cachedPrivateRead(scopeKey, [CACHE_TAGS.financial], async () => {
      const accounts = await db.account.findMany({
        where: session.role === UserRole.ACCOUNT_MGR
          ? { isActive: true, accountAccess: { some: { userId: session.userId } } }
          : { isActive: true },
        select: {
          id: true, name: true, currency: true,
          depositProfitRate: true, withdrawalProfitRate: true,
        },
      })
      const accountIds = session.role === UserRole.ACCOUNT_MGR
        ? accounts.map((account: { id: string }) => account.id)
        : undefined
      const [aggregates, recentBatches, expenseAgg] = await Promise.all([
        getFinancialAggregates({ accountIds }),
        db.uploadBatch.findMany({
          where: accountIds ? { accountId: { in: accountIds } } : {},
          select: {
            id: true, batchDate: true, status: true, rowsProcessed: true,
            account: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        db.expense.aggregate({ where: { deletedAt: null }, _sum: { amount: true } }),
      ])

      type Account = typeof accounts[number]
      const aggregateByAccount = new Map<string, typeof aggregates>()
      for (const aggregate of aggregates) {
        const rows = aggregateByAccount.get(aggregate.accountId) || []
        rows.push(aggregate)
        aggregateByAccount.set(aggregate.accountId, rows)
      }

      const accountSummaries = (accounts as Account[]).flatMap(account => {
        const rows = aggregateByAccount.get(account.id) || []
        const sourceRows = rows.length > 0 ? rows : [{
          accountId: account.id,
          currency: account.currency || 'USD',
          matchedDepositCount: 0, matchedDepositAmount: 0,
          matchedWithdrawalCount: 0, matchedWithdrawalAmount: 0,
          pendingScCount: 0, pendingScAmount: 0,
          pendingPCount: 0, pendingPAmount: 0,
          discrepancyCount: 0, discrepancyAmount: 0,
          depositWasteAmount: 0, withdrawalWasteAmount: 0,
          depositExtrasAmount: 0, withdrawalExtrasAmount: 0,
          internalDepositCount: 0, internalDepositAmount: 0,
          internalWithdrawalCount: 0, internalWithdrawalAmount: 0,
        }]
        return sourceRows.map(row => {
          const matchedCount = Number(row.matchedDepositCount) + Number(row.matchedWithdrawalCount)
          const depositAmount = decimal(row.matchedDepositAmount)
          const withdrawalAmount = decimal(row.matchedWithdrawalAmount)
          const grossProfit = depositAmount * Number(account.depositProfitRate) / 100
            + withdrawalAmount * Number(account.withdrawalProfitRate) / 100
          const wasteAmount = decimal(row.depositWasteAmount) + decimal(row.withdrawalWasteAmount)
          const extrasAmount = decimal(row.depositExtrasAmount) + decimal(row.withdrawalExtrasAmount)
          const internalCount = Number(row.internalDepositCount) + Number(row.internalWithdrawalCount)
          const internalAmount = decimal(row.internalDepositAmount) + decimal(row.internalWithdrawalAmount)
          return {
            accountId: account.id,
            accountName: account.name,
            currency: row.currency,
            matchedCount,
            pendingCount: Number(row.pendingScCount) + Number(row.pendingPCount) + Number(row.discrepancyCount),
            grossProfit,
            wasteAmount,
            extrasAmount,
            netProfit: grossProfit - wasteAmount,
            internalCount,
            internalAmount,
            pendingScCount: Number(row.pendingScCount),
            pendingPCount: Number(row.pendingPCount),
            discrepancyCount: Number(row.discrepancyCount),
          }
        })
      })

      const totalMatched = accountSummaries.reduce((sum, row) => sum + row.matchedCount, 0)
      const totalPendingSC = accountSummaries.reduce((sum, row) => sum + row.pendingScCount, 0)
      const totalPendingP = accountSummaries.reduce((sum, row) => sum + row.pendingPCount, 0)
      const totalDiscrepancy = accountSummaries.reduce((sum, row) => sum + row.discrepancyCount, 0)
      const totalInternal = accountSummaries.reduce((sum, row) => sum + row.internalCount, 0)
      const totalMatchedAmount = aggregates.reduce(
        (sum, row) => sum + decimal(row.matchedDepositAmount) + decimal(row.matchedWithdrawalAmount),
        0,
      )
      const totalWasteAmount = accountSummaries.reduce((sum, row) => sum + row.wasteAmount, 0)
      const totalExtrasAmount = accountSummaries.reduce((sum, row) => sum + row.extrasAmount, 0)
      const isRestricted = session.role === UserRole.SUPERVISOR || session.role === UserRole.ACCOUNT_MGR

      return {
        totalMatched,
        totalMatchedAmount: isRestricted ? undefined : totalMatchedAmount,
        totalPendingSC,
        totalPendingP,
        totalDiscrepancy,
        // Preserve the legacy dashboard semantics: a waste/extra card counts
        // affected account-currency buckets rather than amount rows.
        totalWaste: accountSummaries.filter(row => row.wasteAmount !== 0).length,
        totalWasteAmount: isRestricted ? undefined : totalWasteAmount,
        totalExtras: accountSummaries.filter(row => row.extrasAmount !== 0).length,
        totalExtrasAmount: isRestricted ? undefined : totalExtrasAmount,
        totalInternal,
        recentBatches: recentBatches.map((batch: any) => ({
          id: batch.id,
          accountName: batch.account.name,
          batchDate: batch.batchDate.toISOString(),
          status: batch.status,
          rowsProcessed: batch.rowsProcessed,
        })),
        accountSummaries: isRestricted
          ? accountSummaries.map(({ grossProfit, wasteAmount, extrasAmount, netProfit, internalCount, internalAmount, pendingScCount, pendingPCount, discrepancyCount, ...row }) => row)
          : accountSummaries,
        totalExpenses: isRestricted ? undefined : decimal(expenseAgg._sum.amount),
        isRestricted,
      }
    })

    const payload = { success: true, data }
    return NextResponse.json(payload, {
      headers: requestMetricsHeaders(startedAt, {
        dbMs: performance.now() - dbStartedAt,
        queryCount: 5,
        rowCount: data.accountSummaries.length,
        responseBytes: estimateJsonBytes(payload),
      }),
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
