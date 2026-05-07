import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { TransactionStatus, TransactionType, TransactionSource, UserRole } from '@/lib/db/prisma-types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    if (session.role === UserRole.SUPERVISOR || session.role === UserRole.ACCOUNT_MGR) {
      return NextResponse.json({ error: 'غير مصرح بالوصول' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const accountId = searchParams.get('accountId')

    let accountIds: string[] | null = null
    if ((session.role as string) === UserRole.ACCOUNT_MGR) {
      const access = await db.accountAccess.findMany({ where: { userId: session.userId } })
      accountIds = access.map((a: { accountId: string }) => a.accountId)
    } else if (accountId) {
      accountIds = [accountId]
    }

    const accounts = await db.account.findMany({
      where: {
        isActive: true,
        ...(accountIds ? { id: { in: accountIds } } : {}),
      },
    })

    const dateFilter = dateFrom || dateTo ? {
      txDateTime: {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59') } : {}),
      },
    } : {}

    const summaries = await Promise.all(
      accounts.map(async (account: typeof accounts[0]) => {
        // Get distinct currencies used in this account's transactions
        const currenciesRaw = await db.transaction.groupBy({
          by: ['currency'],
          where: { accountId: account.id, ...dateFilter },
        })
        const currencies = currenciesRaw.map((c: { currency: string }) => c.currency)
        if (currencies.length === 0) currencies.push('USD')

        // Calculate per-currency breakdown
        const currencyBreakdowns = await Promise.all(currencies.map(async (currency: string) => {
        // Exclude COMPLAINT-reviewed operations from profit calculations.
        // Explicit OR so NULL reviewCategory rows (most txs) are kept.
        const baseWhere = {
          accountId: account.id,
          currency,
          ...dateFilter,
          OR: [
            { reviewCategory: null },
            { NOT: { reviewCategory: 'COMPLAINT' as const } },
          ],
        }

        const walletIds = account.walletIdentifiers || []

        // === Matched amounts (source SHAM_CASH to avoid double-counting) ===
        const [depMatched, wdMatched] = await Promise.all([
          db.transaction.aggregate({
            where: { ...baseWhere, type: TransactionType.DEPOSIT, status: TransactionStatus.MATCHED, source: TransactionSource.SHAM_CASH },
            _sum: { amount: true }, _count: true,
          }),
          db.transaction.aggregate({
            where: { ...baseWhere, type: TransactionType.WITHDRAWAL, status: TransactionStatus.MATCHED, source: TransactionSource.SHAM_CASH },
            _sum: { amount: true }, _count: true,
          }),
        ])

        // === WASTE components (deductions from profit) ===
        // 1. إيداعات المنصة فقط (لا يوجد شام كاش مقابل) — counted as waste
        const depPlatformOnly = await db.transaction.aggregate({
          where: { ...baseWhere, type: TransactionType.DEPOSIT, status: TransactionStatus.PENDING_P, source: TransactionSource.PLATFORM },
          _sum: { amount: true }, _count: true,
        })

        // 2. فارق إيداع - المنصة أكبر (نحن دفعنا أكثر)
        const depDiscrepancyPHigher = await db.transaction.aggregate({
          where: { ...baseWhere, type: TransactionType.DEPOSIT, status: TransactionStatus.DISCREPANCY, source: TransactionSource.PLATFORM },
          _sum: { amountDiff: true }, _count: true,
        })

        // 3. فارق سحب - شام كاش أكبر (نحن أرسلنا أكثر)
        const wdDiscrepancySCHigher = await db.transaction.aggregate({
          where: { ...baseWhere, type: TransactionType.WITHDRAWAL, status: TransactionStatus.DISCREPANCY, source: TransactionSource.SHAM_CASH },
          _sum: { amountDiff: true }, _count: true,
        })

        // === EXTRAS components (NOT profit, NOT waste - outside net calculation) ===
        // 1. إيداع شام كاش فقط — filtered by wallet identifiers (exclude internal)
        let extras_depSCOnly_computed = 0
        if (walletIds.length > 0) {
          const depSCOnlyRows = await db.transaction.findMany({
            where: { ...baseWhere, type: TransactionType.DEPOSIT, status: TransactionStatus.PENDING_SC },
            select: { amount: true, rawData: true },
          })
          extras_depSCOnly_computed = depSCOnlyRows
            .filter((t: { rawData: unknown }) => {
              const raw = t.rawData as Record<string, unknown> | null
              if (!raw) return true
              const accNum = String(raw.accountNumber || '')
              const accName = String(raw.accountName || '')
              const notes = String(raw.notes || '')
              const isInternal = walletIds.some((wid: string) =>
                accNum.includes(wid) || accName.includes(wid) || notes.includes(wid)
              )
              return !isInternal
            })
            .reduce((sum: number, t: { amount: unknown }) => sum + Number(t.amount || 0), 0)
        } else {
          const depSCOnly = await db.transaction.aggregate({
            where: { ...baseWhere, type: TransactionType.DEPOSIT, status: TransactionStatus.PENDING_SC },
            _sum: { amount: true },
          })
          extras_depSCOnly_computed = Number(depSCOnly._sum.amount || 0)
        }

        // 2. فارق إيداع - شام كاش أكبر (العميل أرسل أكثر)
        const depDiscrepancySCHigher = await db.transaction.aggregate({
          where: { ...baseWhere, type: TransactionType.DEPOSIT, status: TransactionStatus.DISCREPANCY, source: TransactionSource.SHAM_CASH },
          _sum: { amountDiff: true }, _count: true,
        })

        // 3. سحوبات المنصة فقط (لم يُرسل من شام كاش)
        const wdPlatformOnly = await db.transaction.aggregate({
          where: { ...baseWhere, type: TransactionType.WITHDRAWAL, status: TransactionStatus.PENDING_P },
          _sum: { amount: true }, _count: true,
        })

        // 4. فارق سحب - المنصة أكبر (وصل للعميل أكثر)
        const wdDiscrepancyPHigher = await db.transaction.aggregate({
          where: { ...baseWhere, type: TransactionType.WITHDRAWAL, status: TransactionStatus.DISCREPANCY, source: TransactionSource.PLATFORM },
          _sum: { amountDiff: true }, _count: true,
        })

        // SC-only withdrawals — filtered by wallet identifiers at query time
        let waste_wdSCOnly_computed = 0
        if (walletIds.length > 0) {
          // Fetch and filter in memory by wallet identifiers
          const scOnlyRows = await db.transaction.findMany({
            where: { ...baseWhere, type: TransactionType.WITHDRAWAL, status: TransactionStatus.PENDING_SC },
            select: { amount: true, rawData: true },
          })
          const matchingRows = scOnlyRows.filter((t: { rawData: unknown }) => {
            const raw = t.rawData as Record<string, unknown> | null
            if (!raw) return true
            const accNum = String(raw.accountNumber || '')
            const accName = String(raw.accountName || '')
            const notes = String(raw.notes || '')
            // EXCLUDE transactions that match our identifiers (internal transfers)
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
          waste_wdSCOnly_computed = matchingRows.reduce((sum: number, t: { amount: unknown }) => sum + Number(t.amount || 0), 0)
        } else {
          // No wallet filter — count all
          const wdSCOnly = await db.transaction.aggregate({
            where: { ...baseWhere, type: TransactionType.WITHDRAWAL, status: TransactionStatus.PENDING_SC },
            _sum: { amount: true },
          })
          waste_wdSCOnly_computed = Number(wdSCOnly._sum.amount || 0)
        }

        const depMatchedAmt = Number(depMatched._sum.amount || 0)
        const wdMatchedAmt = Number(wdMatched._sum.amount || 0)

        const depRate = Number(account.depositProfitRate) / 100
        const wdRate = Number(account.withdrawalProfitRate) / 100

        const depGross = depMatchedAmt * depRate
        const wdGross = wdMatchedAmt * wdRate

        // === WASTE breakdown (deducted from net profit) ===
        const waste_depPlatformOnly = Number(depPlatformOnly._sum.amount || 0)
        const waste_depDiscrepancyPHigher = Number(depDiscrepancyPHigher._sum.amountDiff || 0)
        const waste_wdDiscrepancySCHigher = Number(wdDiscrepancySCHigher._sum.amountDiff || 0)
        const depWaste = waste_depPlatformOnly + waste_depDiscrepancyPHigher
        const wdWaste = waste_wdDiscrepancySCHigher + waste_wdSCOnly_computed
        const totalWaste = depWaste + wdWaste

        // === EXTRAS breakdown (NOT counted in net profit) ===
        const extras_depSCOnly = extras_depSCOnly_computed
        const extras_depDiscrepancySCHigher = Number(depDiscrepancySCHigher._sum.amountDiff || 0)
        const extras_wdPlatformOnly = Number(wdPlatformOnly._sum.amount || 0)
        const extras_wdDiscrepancyPHigher = Number(wdDiscrepancyPHigher._sum.amountDiff || 0)

        const depExtras = extras_depSCOnly + extras_depDiscrepancySCHigher
        const wdExtras = extras_wdPlatformOnly + extras_wdDiscrepancyPHigher
        const totalExtras = depExtras + wdExtras

        const depNet = depGross - depWaste
        const wdNet = wdGross - wdWaste

        // === INTERNAL TRANSFERS (اسم الحساب يطابق معرّفاتنا) ===
        let internalDeposits = { count: 0, amount: 0 }
        let internalWithdrawals = { count: 0, amount: 0 }
        if (walletIds.length > 0) {
          const [scDepRows, scWdRows] = await Promise.all([
            db.transaction.findMany({
              where: { ...baseWhere, type: TransactionType.DEPOSIT, status: TransactionStatus.PENDING_SC, source: TransactionSource.SHAM_CASH },
              select: { amount: true, rawData: true },
            }),
            db.transaction.findMany({
              where: { ...baseWhere, type: TransactionType.WITHDRAWAL, status: TransactionStatus.PENDING_SC, source: TransactionSource.SHAM_CASH },
              select: { amount: true, rawData: true },
            }),
          ])
          const isInternal = (raw: Record<string, unknown> | null) => {
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
          }
          const depInternal = scDepRows.filter((t: { rawData: unknown }) => isInternal(t.rawData as Record<string, unknown> | null))
          const wdInternal = scWdRows.filter((t: { rawData: unknown }) => isInternal(t.rawData as Record<string, unknown> | null))
          internalDeposits = {
            count: depInternal.length,
            amount: depInternal.reduce((s: number, t: { amount: unknown }) => s + Number(t.amount || 0), 0),
          }
          internalWithdrawals = {
            count: wdInternal.length,
            amount: wdInternal.reduce((s: number, t: { amount: unknown }) => s + Number(t.amount || 0), 0),
          }
        }

        return {
          currency,
          deposits: {
            matched: depMatched._count,
            matchedAmount: depMatchedAmt,
            profitRate: Number(account.depositProfitRate),
            grossProfit: depGross,
            waste: depWaste,
            wasteBreakdown: { platformOnly: waste_depPlatformOnly, discrepancyPHigher: waste_depDiscrepancyPHigher },
            extras: depExtras,
            extrasBreakdown: { scOnly: extras_depSCOnly, discrepancySCHigher: extras_depDiscrepancySCHigher },
            netProfit: depNet,
          },
          withdrawals: {
            matched: wdMatched._count,
            matchedAmount: wdMatchedAmt,
            profitRate: Number(account.withdrawalProfitRate),
            grossProfit: wdGross,
            waste: wdWaste,
            wasteBreakdown: { discrepancySCHigher: waste_wdDiscrepancySCHigher, scOnly: waste_wdSCOnly_computed },
            extras: wdExtras,
            extrasBreakdown: { platformOnly: extras_wdPlatformOnly, discrepancyPHigher: extras_wdDiscrepancyPHigher },
            netProfit: wdNet,
          },
          totalGrossProfit: depGross + wdGross,
          totalWaste,
          totalExtras,
          totalNetProfit: depNet + wdNet,
          internalTransfers: {
            deposits: internalDeposits,
            withdrawals: internalWithdrawals,
            totalCount: internalDeposits.count + internalWithdrawals.count,
            totalAmount: internalDeposits.amount + internalWithdrawals.amount,
          },
        }
        }))

        return {
          accountId: account.id,
          accountName: account.name,
          currencyBreakdowns,
        }
      })
    )

    const expensesTotal = await db.expense.aggregate({
      where: { deletedAt: null },
      _sum: { amount: true },
    })

    const totalExpenses = Number(expensesTotal._sum.amount || 0)

    // Flatten accounts into a compatible format for the frontend
    // Each account has multiple currency breakdowns
    const flatAccounts = summaries.flatMap((s: typeof summaries[0]) =>
      s.currencyBreakdowns.map((cb: typeof s.currencyBreakdowns[0]) => ({
        accountId: s.accountId,
        accountName: s.accountName,
        currency: cb.currency,
        deposits: cb.deposits,
        withdrawals: cb.withdrawals,
        totalGrossProfit: cb.totalGrossProfit,
        totalWaste: cb.totalWaste,
        totalExtras: cb.totalExtras,
        totalNetProfit: cb.totalNetProfit,
        internalTransfers: cb.internalTransfers,
      }))
    )

    return NextResponse.json({
      success: true,
      data: {
        accounts: flatAccounts,
        totalExpenses,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
