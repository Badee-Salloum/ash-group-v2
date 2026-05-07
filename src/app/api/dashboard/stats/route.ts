import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { TransactionStatus, TransactionType, TransactionSource, UserRole } from '@/lib/db/prisma-types'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    // Financial dashboard is for finance/admin roles only — EMPLOYEE/MANAGER
    // (HR-scoped) must not see global revenue, profits, or transactions.
    const allowed: string[] = [
      UserRole.ADMIN,
      UserRole.SUPERVISOR,
      UserRole.ACCOUNT_MGR,
      'ACCOUNTANT',
    ]
    if (!allowed.includes(session.role)) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 })
    }

    // Determine accessible accounts
    let accountIds: string[] | undefined
    if (session.role === UserRole.ACCOUNT_MGR) {
      const access = await db.accountAccess.findMany({ where: { userId: session.userId } })
      accountIds = access.map((a: { accountId: string }) => a.accountId)
    }

    // Exclude COMPLAINT-reviewed operations from every dashboard number.
    // We use explicit OR because Prisma's `{ not: 'X' }` excludes NULL rows
    // (SQL NULL != 'X' is unknown), and most transactions have reviewCategory = null.
    const notComplaintFilter = {
      OR: [
        { reviewCategory: null },
        { NOT: { reviewCategory: 'COMPLAINT' as const } },
      ],
    }
    const where: Record<string, unknown> = accountIds
      ? { accountId: { in: accountIds }, ...notComplaintFilter }
      : { ...notComplaintFilter }

    // Count matched using source SHAM_CASH to avoid double-counting pairs
    // "Waste" count = deposit platform-only + discrepancies counted as losses
    const [matched, pendingSC, pendingP, discrepancy, wasteDepPOnly, wasteDepDiscP, wasteWdDiscSC, recentBatches] = await Promise.all([
      db.transaction.aggregate({
        where: { ...where, status: TransactionStatus.MATCHED, source: TransactionSource.SHAM_CASH },
        _count: true, _sum: { amount: true },
      }),
      db.transaction.count({ where: { ...where, status: TransactionStatus.PENDING_SC } }),
      db.transaction.count({ where: { ...where, status: TransactionStatus.PENDING_P } }),
      db.transaction.count({ where: { ...where, status: TransactionStatus.DISCREPANCY } }),
      db.transaction.aggregate({
        where: { ...where, type: TransactionType.DEPOSIT, status: TransactionStatus.PENDING_P, source: TransactionSource.PLATFORM },
        _count: true, _sum: { amount: true },
      }),
      db.transaction.aggregate({
        where: { ...where, type: TransactionType.DEPOSIT, status: TransactionStatus.DISCREPANCY, source: TransactionSource.PLATFORM },
        _count: true, _sum: { amountDiff: true },
      }),
      db.transaction.aggregate({
        where: { ...where, type: TransactionType.WITHDRAWAL, status: TransactionStatus.DISCREPANCY, source: TransactionSource.SHAM_CASH },
        _count: true, _sum: { amountDiff: true },
      }),
      db.uploadBatch.findMany({
        where: accountIds ? { accountId: { in: accountIds } } : {},
        include: { account: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ])

    // Per-account summary for the accounts table
    const accounts = await db.account.findMany({
      where: accountIds ? { id: { in: accountIds } } : { isActive: true },
      select: { id: true, name: true, currency: true, depositProfitRate: true, withdrawalProfitRate: true, walletIdentifiers: true },
    })

    const accountSummaries = await Promise.all(
      accounts.map(async (account: { id: string; name: string; currency: string; depositProfitRate: unknown; withdrawalProfitRate: unknown; walletIdentifiers: string[] }) => {
        // Get distinct currencies in this account
        const currenciesRaw = await db.transaction.groupBy({
          by: ['currency'],
          where: { accountId: account.id },
        })
        const currencies = currenciesRaw.map((c: { currency: string }) => c.currency)
        if (currencies.length === 0) currencies.push(account.currency || 'USD')

        const perCurrency = await Promise.all(currencies.map(async (currency: string) => {
        // Exclude operations reviewed as COMPLAINT. Use explicit OR so NULL
        // reviewCategory rows (the common case) are still included.
        const notComplaint = {
          OR: [
            { reviewCategory: null },
            { NOT: { reviewCategory: 'COMPLAINT' as const } },
          ],
        }
        const accountWhere = { accountId: account.id, currency, ...notComplaint }

        const [
          matchedDep, matchedWd, pendingCount,
          wasteDepPOnly, wasteDepDiscP, wasteWdDiscSC,
          extrasDepSCOnly, extrasDepDiscSC, extrasWdPOnly, extrasWdDiscP,
        ] = await Promise.all([
          db.transaction.aggregate({
            where: { ...accountWhere, status: TransactionStatus.MATCHED, type: TransactionType.DEPOSIT, source: TransactionSource.SHAM_CASH },
            _count: true, _sum: { amount: true },
          }),
          db.transaction.aggregate({
            where: { ...accountWhere, status: TransactionStatus.MATCHED, type: TransactionType.WITHDRAWAL, source: TransactionSource.SHAM_CASH },
            _count: true, _sum: { amount: true },
          }),
          db.transaction.count({
            where: { ...accountWhere, status: { in: [TransactionStatus.PENDING_SC, TransactionStatus.PENDING_P, TransactionStatus.DISCREPANCY] } },
          }),
          db.transaction.aggregate({
            where: { ...accountWhere, type: TransactionType.DEPOSIT, status: TransactionStatus.PENDING_P, source: TransactionSource.PLATFORM },
            _sum: { amount: true },
          }),
          db.transaction.aggregate({
            where: { ...accountWhere, type: TransactionType.DEPOSIT, status: TransactionStatus.DISCREPANCY, source: TransactionSource.PLATFORM },
            _sum: { amountDiff: true },
          }),
          db.transaction.aggregate({
            where: { ...accountWhere, type: TransactionType.WITHDRAWAL, status: TransactionStatus.DISCREPANCY, source: TransactionSource.SHAM_CASH },
            _sum: { amountDiff: true },
          }),
          db.transaction.aggregate({
            where: { ...accountWhere, type: TransactionType.DEPOSIT, status: TransactionStatus.PENDING_SC },
            _sum: { amount: true },
          }),
          db.transaction.aggregate({
            where: { ...accountWhere, type: TransactionType.DEPOSIT, status: TransactionStatus.DISCREPANCY, source: TransactionSource.SHAM_CASH },
            _sum: { amountDiff: true },
          }),
          db.transaction.aggregate({
            where: { ...accountWhere, type: TransactionType.WITHDRAWAL, status: TransactionStatus.PENDING_P },
            _sum: { amount: true },
          }),
          db.transaction.aggregate({
            where: { ...accountWhere, type: TransactionType.WITHDRAWAL, status: TransactionStatus.DISCREPANCY, source: TransactionSource.PLATFORM },
            _sum: { amountDiff: true },
          }),
        ])

        const depAmount = Number(matchedDep._sum.amount || 0)
        const wdAmount = Number(matchedWd._sum.amount || 0)
        const depRate = Number(account.depositProfitRate) / 100
        const wdRate = Number(account.withdrawalProfitRate) / 100

        // Calculate wdSCOnly waste filtered by wallet identifiers
        const walletIds = account.walletIdentifiers || []
        let wdSCOnlyWaste = 0
        if (walletIds.length > 0) {
          const scOnlyRows = await db.transaction.findMany({
            where: { ...accountWhere, type: TransactionType.WITHDRAWAL, status: TransactionStatus.PENDING_SC },
            select: { amount: true, rawData: true },
          })
          wdSCOnlyWaste = scOnlyRows
            .filter((t: { rawData: unknown }) => {
              const raw = t.rawData as Record<string, unknown> | null
              if (!raw) return true
              const accNum = String(raw.accountNumber || '')
              const accName = String(raw.accountName || '')
              const notes = String(raw.notes || '')
              // EXCLUDE internal transfers (matching our identifiers)
              const text = `${accNum} ${accName} ${notes}`.toLowerCase()
              const isInternal = walletIds.some((wid: string) => {
                const words = wid.trim().split(/\s+/).filter(Boolean)
                if (words.length === 0) return false
                const textTokens = new Set(text.split(/\s+/).filter(Boolean))
                return words.every((word: string) => {
                  const w = word.toLowerCase()
                  return w.length >= 2 ? text.includes(w) : textTokens.has(w)
                })
              })
              return !isInternal
            })
            .reduce((sum: number, t: { amount: unknown }) => sum + Number(t.amount || 0), 0)
        } else {
          const wdSCOnlyAgg = await db.transaction.aggregate({
            where: { ...accountWhere, type: TransactionType.WITHDRAWAL, status: TransactionStatus.PENDING_SC },
            _sum: { amount: true },
          })
          wdSCOnlyWaste = Number(wdSCOnlyAgg._sum.amount || 0)
        }

        const grossProfit = (depAmount * depRate) + (wdAmount * wdRate)
        const wasteAmount = Number(wasteDepPOnly._sum.amount || 0) +
          Number(wasteDepDiscP._sum.amountDiff || 0) +
          Number(wasteWdDiscSC._sum.amountDiff || 0) +
          wdSCOnlyWaste
        // Filter depSCOnly extras by wallet identifiers (exclude internal)
        let filteredDepSCOnly = Number(extrasDepSCOnly._sum.amount || 0)
        if (walletIds.length > 0) {
          const depSCRows = await db.transaction.findMany({
            where: { ...accountWhere, type: TransactionType.DEPOSIT, status: TransactionStatus.PENDING_SC },
            select: { amount: true, rawData: true },
          })
          filteredDepSCOnly = depSCRows
            .filter((t: { rawData: unknown }) => {
              const raw = t.rawData as Record<string, unknown> | null
              if (!raw) return true
              const accNum = String(raw.accountNumber || '')
              const accName = String(raw.accountName || '')
              const notes = String(raw.notes || '')
              return !walletIds.some((wid: string) => accNum.includes(wid) || accName.includes(wid) || notes.includes(wid))
            })
            .reduce((sum: number, t: { amount: unknown }) => sum + Number(t.amount || 0), 0)
        }

        const extrasAmount = filteredDepSCOnly +
          Number(extrasDepDiscSC._sum.amountDiff || 0) +
          Number(extrasWdPOnly._sum.amount || 0) +
          Number(extrasWdDiscP._sum.amountDiff || 0)

        // Internal transfers (count + amount)
        let internalCount = 0
        let internalAmount = 0
        if (walletIds.length > 0) {
          const scRows = await db.transaction.findMany({
            where: { ...accountWhere, status: TransactionStatus.PENDING_SC, source: TransactionSource.SHAM_CASH },
            select: { amount: true, rawData: true },
          })
          const internalRows = scRows.filter((t: { rawData: unknown }) => {
            const raw = t.rawData as Record<string, unknown> | null
            if (!raw) return false
            const text = `${raw.accountNumber || ''} ${raw.accountName || ''} ${raw.notes || ''}`.toLowerCase()
            return walletIds.some((wid: string) => {
              const words = wid.trim().split(/\s+/).filter(Boolean)
              if (words.length === 0) return false
              const textTokens = new Set(text.split(/\s+/).filter(Boolean))
              return words.every((word: string) => {
                const w = word.toLowerCase()
                return w.length >= 2 ? text.includes(w) : textTokens.has(w)
              })
            })
          })
          internalCount = internalRows.length
          internalAmount = internalRows.reduce((s: number, t: { amount: unknown }) => s + Number(t.amount || 0), 0)
        }
        const netProfit = grossProfit - wasteAmount

        return {
          currency,
          matchedCount: matchedDep._count + matchedWd._count,
          pendingCount: pendingCount - internalCount,
          grossProfit,
          wasteAmount,
          extrasAmount,
          netProfit,
          internalCount,
          internalAmount,
        }
        }))

        return perCurrency.map((pc: typeof perCurrency[0]) => ({
          accountId: account.id,
          accountName: account.name,
          currency: pc.currency,
          matchedCount: pc.matchedCount,
          pendingCount: pc.pendingCount,
          grossProfit: pc.grossProfit,
          wasteAmount: pc.wasteAmount,
          extrasAmount: pc.extrasAmount,
          netProfit: pc.netProfit,
          internalCount: pc.internalCount,
          internalAmount: pc.internalAmount,
        }))
      })
    )

    // Flatten nested arrays
    const flatSummaries = accountSummaries.flat()

    // Compute totals FROM filtered per-account summaries (consistent with profits page)
    // Count only summaries that ACTUALLY have a non-zero amount — otherwise an
    // account with zero waste was being counted as "1 waste record".
    const totalWasteAmount = flatSummaries.reduce((s: number, a: any) => s + (a.wasteAmount || 0), 0)
    const totalWasteCount = flatSummaries.filter((a: any) => (a.wasteAmount || 0) !== 0).length
    const totalExtrasAmount = flatSummaries.reduce((s: number, a: any) => s + (a.extrasAmount || 0), 0)
    const totalExtrasCount = flatSummaries.filter((a: any) => (a.extrasAmount || 0) !== 0).length
    const totalInternalCount = flatSummaries.reduce((s: number, a: any) => s + (a.internalCount || 0), 0)

    // Total expenses
    const expenseAgg = await db.expense.aggregate({
      where: { deletedAt: null },
      _sum: { amount: true },
    })
    const totalExpenses = Number(expenseAgg._sum.amount || 0)

    const isRestricted = session.role === UserRole.SUPERVISOR || session.role === UserRole.ACCOUNT_MGR

    return NextResponse.json({
      success: true,
      data: {
        totalMatched: matched._count,
        totalMatchedAmount: isRestricted ? undefined : Number(matched._sum.amount || 0),
        totalPendingSC: pendingSC - totalInternalCount,
        totalPendingP: pendingP,
        totalDiscrepancy: discrepancy,
        totalWaste: totalWasteCount,
        totalWasteAmount: isRestricted ? undefined : totalWasteAmount,
        totalExtras: totalExtrasCount,
        totalExtrasAmount: isRestricted ? undefined : totalExtrasAmount,
        totalInternal: totalInternalCount,
        recentBatches: recentBatches.map((b: any) => ({
          id: b.id,
          accountName: b.account.name,
          batchDate: b.batchDate.toISOString(),
          status: b.status,
          rowsProcessed: b.rowsProcessed,
        })),
        accountSummaries: isRestricted
          ? flatSummaries.map((a: any) => ({
              accountId: a.accountId,
              accountName: a.accountName,
              currency: a.currency,
              matchedCount: a.matchedCount,
              pendingCount: a.pendingCount,
            }))
          : flatSummaries,
        totalExpenses: isRestricted ? undefined : totalExpenses,
        isRestricted,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
