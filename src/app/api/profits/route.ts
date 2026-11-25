import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole } from '@/lib/db/prisma-types'
import { decimal, getFinancialAggregates } from '@/lib/financial/aggregates'
import { CACHE_TAGS, cachedPrivateRead, estimateJsonBytes, requestMetricsHeaders } from '@/lib/performance/cache'
import { addDays, damascusDayStartUtc } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

function parseCalendarDate(value: string | null): string | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || !date.toISOString().startsWith(value) ? null : value
}

/**
 * Profit report backed by one grouped transaction query rather than a nested
 * account/currency fan-out. It deliberately keeps the response shape used by
 * the existing Profit components, including each detail breakdown.
 */
export async function GET(req: NextRequest) {
  const startedAt = performance.now()
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    if (session.role !== UserRole.ADMIN && (session.role as string) !== 'ACCOUNTANT') {
      return NextResponse.json({ error: 'غير مصرح بالوصول' }, { status: 403 })
    }

    const params = req.nextUrl.searchParams
    const dateFromCalendar = parseCalendarDate(params.get('dateFrom'))
    const dateToCalendar = parseCalendarDate(params.get('dateTo'))
    if ((params.get('dateFrom') && !dateFromCalendar) || (params.get('dateTo') && !dateToCalendar)) {
      return NextResponse.json({ error: 'نطاق التاريخ غير صالح' }, { status: 400 })
    }
    if (dateFromCalendar && dateToCalendar && dateFromCalendar > dateToCalendar) {
      return NextResponse.json({ error: 'dateFrom must be on or before dateTo' }, { status: 400 })
    }
    // Date filtering follows the Damascus business calendar used by the
    // summaries. This keeps the direct fallback and read-model path aligned.
    const dateFrom = dateFromCalendar ? damascusDayStartUtc(dateFromCalendar) : null
    const dateToExclusive = dateToCalendar ? damascusDayStartUtc(addDays(dateToCalendar, 1)) : null
    const accountId = params.get('accountId') || null
    const scopeKey = `${session.role}:${session.userId}:${accountId || 'all'}:${dateFrom?.toISOString() || ''}:${dateToExclusive?.toISOString() || ''}`

    const dbStartedAt = performance.now()
    const data = await cachedPrivateRead(scopeKey, [CACHE_TAGS.financial], async () => {
      const scopedIds = accountId ? [accountId] : undefined
      const [accounts, aggregates, expenseAgg] = await Promise.all([
        db.account.findMany({
          where: { isActive: true, ...(scopedIds ? { id: { in: scopedIds } } : {}) },
          select: { id: true, name: true, currency: true, depositProfitRate: true, withdrawalProfitRate: true },
        }),
        getFinancialAggregates({ accountIds: scopedIds, dateFrom, dateToExclusive }),
        db.expense.aggregate({ where: { deletedAt: null }, _sum: { amount: true } }),
      ])

      const rowsByAccount = new Map<string, typeof aggregates>()
      for (const row of aggregates) {
        const current = rowsByAccount.get(row.accountId) || []
        current.push(row)
        rowsByAccount.set(row.accountId, current)
      }

      const accountsData = accounts.flatMap((account: typeof accounts[number]) => {
        const aggregateRows = rowsByAccount.get(account.id) || []
        const rows = aggregateRows.length > 0 ? aggregateRows : [{
          accountId: account.id,
          currency: account.currency || 'USD',
          matchedDepositCount: 0, matchedDepositAmount: 0,
          matchedWithdrawalCount: 0, matchedWithdrawalAmount: 0,
          pendingScCount: 0, pendingScAmount: 0, pendingPCount: 0, pendingPAmount: 0,
          discrepancyCount: 0, discrepancyAmount: 0,
          depositWasteAmount: 0, withdrawalWasteAmount: 0,
          depositExtrasAmount: 0, withdrawalExtrasAmount: 0,
          depositPlatformOnlyAmount: 0, depositDiscrepancyPHigherAmount: 0,
          withdrawalScOnlyAmount: 0, withdrawalDiscrepancySCHigherAmount: 0,
          depositScOnlyAmount: 0, depositDiscrepancySCHigherAmount: 0,
          withdrawalPlatformOnlyAmount: 0, withdrawalDiscrepancyPHigherAmount: 0,
          internalDepositCount: 0, internalDepositAmount: 0,
          internalWithdrawalCount: 0, internalWithdrawalAmount: 0,
        }]
        return rows.map(row => {
          const depositMatchedAmount = decimal(row.matchedDepositAmount)
          const withdrawalMatchedAmount = decimal(row.matchedWithdrawalAmount)
          const depositGross = depositMatchedAmount * Number(account.depositProfitRate) / 100
          const withdrawalGross = withdrawalMatchedAmount * Number(account.withdrawalProfitRate) / 100
          const depositWaste = decimal(row.depositWasteAmount)
          const withdrawalWaste = decimal(row.withdrawalWasteAmount)
          const depositExtras = decimal(row.depositExtrasAmount)
          const withdrawalExtras = decimal(row.withdrawalExtrasAmount)
          return {
            accountId: account.id,
            accountName: account.name,
            currency: row.currency,
            deposits: {
              matched: Number(row.matchedDepositCount),
              matchedAmount: depositMatchedAmount,
              profitRate: Number(account.depositProfitRate),
              grossProfit: depositGross,
              waste: depositWaste,
              wasteBreakdown: {
                platformOnly: decimal(row.depositPlatformOnlyAmount),
                discrepancyPHigher: decimal(row.depositDiscrepancyPHigherAmount),
              },
              extras: depositExtras,
              extrasBreakdown: {
                scOnly: decimal(row.depositScOnlyAmount),
                discrepancySCHigher: decimal(row.depositDiscrepancySCHigherAmount),
              },
              netProfit: depositGross - depositWaste,
            },
            withdrawals: {
              matched: Number(row.matchedWithdrawalCount),
              matchedAmount: withdrawalMatchedAmount,
              profitRate: Number(account.withdrawalProfitRate),
              grossProfit: withdrawalGross,
              waste: withdrawalWaste,
              wasteBreakdown: {
                scOnly: decimal(row.withdrawalScOnlyAmount),
                discrepancySCHigher: decimal(row.withdrawalDiscrepancySCHigherAmount),
              },
              extras: withdrawalExtras,
              extrasBreakdown: {
                platformOnly: decimal(row.withdrawalPlatformOnlyAmount),
                discrepancyPHigher: decimal(row.withdrawalDiscrepancyPHigherAmount),
              },
              netProfit: withdrawalGross - withdrawalWaste,
            },
            totalGrossProfit: depositGross + withdrawalGross,
            totalWaste: depositWaste + withdrawalWaste,
            totalExtras: depositExtras + withdrawalExtras,
            totalNetProfit: depositGross + withdrawalGross - depositWaste - withdrawalWaste,
            internalTransfers: {
              deposits: { count: Number(row.internalDepositCount), amount: decimal(row.internalDepositAmount) },
              withdrawals: { count: Number(row.internalWithdrawalCount), amount: decimal(row.internalWithdrawalAmount) },
              totalCount: Number(row.internalDepositCount) + Number(row.internalWithdrawalCount),
              totalAmount: decimal(row.internalDepositAmount) + decimal(row.internalWithdrawalAmount),
            },
          }
        })
      })

      const profitRows = accountsData as Array<{ totalNetProfit: number; totalExtras: number }>
      const totalNetProfit = profitRows.reduce((sum: number, account) => sum + account.totalNetProfit, 0)
      const totalExtras = profitRows.reduce((sum: number, account) => sum + account.totalExtras, 0)
      const totalExpenses = decimal(expenseAgg._sum.amount)
      return {
        accounts: accountsData,
        totalExpenses,
        totalNetProfit,
        totalExtras,
        finalProfit: totalNetProfit - totalExpenses,
      }
    })

    const payload = { success: true, data }
    return NextResponse.json(payload, {
      headers: requestMetricsHeaders(startedAt, {
        dbMs: performance.now() - dbStartedAt,
        queryCount: 4,
        rowCount: data.accounts.length,
        responseBytes: estimateJsonBytes(payload),
      }),
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
