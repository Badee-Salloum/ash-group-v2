import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole, TransactionStatus } from '@/lib/db/prisma-types'
import { isInternalTransfer } from '@/lib/reconciliation/walletMatch'

// Aggregate customer tracking data grouped by accountName extracted from rawData.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const accountIdFilter = req.nextUrl.searchParams.get('accountId') || undefined
    const currencyFilter = req.nextUrl.searchParams.get('currency') || undefined
    const dateFrom = req.nextUrl.searchParams.get('dateFrom')
    const dateTo = req.nextUrl.searchParams.get('dateTo')

    // Scope: ACCOUNT_MGR only sees their accounts
    let allowedAccountIds: string[] | null = null
    if (session.role === UserRole.ACCOUNT_MGR) {
      const access = await db.accountAccess.findMany({ where: { userId: session.userId } })
      allowedAccountIds = access.map((a: { accountId: string }) => a.accountId)
    }

    const where: Record<string, unknown> = {}
    if (allowedAccountIds) where.accountId = { in: allowedAccountIds }
    else if (accountIdFilter) where.accountId = accountIdFilter
    if (currencyFilter) where.currency = currencyFilter
    if (dateFrom || dateTo) {
      where.txDateTime = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59') } : {}),
      }
    }

    const accounts = await db.account.findMany({
      where: allowedAccountIds ? { id: { in: allowedAccountIds } } : {},
      select: { id: true, name: true, walletIdentifiers: true },
    })
    const walletMap = new Map<string, string[]>(
      accounts.map((a: { id: string; walletIdentifiers: string[] }) => [a.id, a.walletIdentifiers || []])
    )
    const accountNameMap = new Map<string, string>(
      accounts.map((a: { id: string; name: string }) => [a.id, a.name])
    )

    const transactions = await db.transaction.findMany({
      where,
      select: {
        id: true,
        accountId: true,
        type: true,
        status: true,
        amount: true,
        currency: true,
        txDateTime: true,
        rawData: true,
      },
      take: 100000,
    })

    type Row = typeof transactions[0]
    type Customer = {
      name: string
      accounts: Set<string>
      accountLabels: Set<string>
      currencies: Set<string>
      depositCount: number
      depositSum: Record<string, number>
      withdrawalCount: number
      withdrawalSum: Record<string, number>
      discrepancyCount: number
      matchedCount: number
      pendingCount: number
      firstSeen: Date
      lastSeen: Date
      lastOpType: string
      lastOpAmount: number
      lastOpCurrency: string
    }

    const map = new Map<string, Customer>()

    for (const t of transactions as Row[]) {
      const raw = (t.rawData || {}) as Record<string, unknown>
      const scInner = raw.sc as Record<string, unknown> | undefined
      const accName = String(raw.accountName || scInner?.accountName || '').trim()
      if (!accName) continue

      const walletIds = walletMap.get(t.accountId) || []
      const accountNumber = String(raw.accountNumber || '')
      const notes = String(raw.notes || '')
      if (isInternalTransfer(accountNumber, accName, notes, walletIds)) continue

      const key = accName
      if (!map.has(key)) {
        map.set(key, {
          name: accName,
          accounts: new Set(),
          accountLabels: new Set(),
          currencies: new Set(),
          depositCount: 0,
          depositSum: {},
          withdrawalCount: 0,
          withdrawalSum: {},
          discrepancyCount: 0,
          matchedCount: 0,
          pendingCount: 0,
          firstSeen: t.txDateTime,
          lastSeen: t.txDateTime,
          lastOpType: t.type,
          lastOpAmount: Number(t.amount),
          lastOpCurrency: t.currency,
        })
      }
      const c = map.get(key)!
      c.accounts.add(t.accountId)
      const accLabel = accountNameMap.get(t.accountId) || ''
      if (accLabel) c.accountLabels.add(accLabel)
      c.currencies.add(t.currency)

      const amt = Number(t.amount)
      if (t.type === 'DEPOSIT') {
        c.depositCount++
        c.depositSum[t.currency] = (c.depositSum[t.currency] || 0) + amt
      } else {
        c.withdrawalCount++
        c.withdrawalSum[t.currency] = (c.withdrawalSum[t.currency] || 0) + amt
      }

      if (t.status === TransactionStatus.DISCREPANCY) c.discrepancyCount++
      if (t.status === TransactionStatus.MATCHED) c.matchedCount++
      if (t.status === TransactionStatus.PENDING_SC || t.status === TransactionStatus.PENDING_P) c.pendingCount++

      if (t.txDateTime < c.firstSeen) c.firstSeen = t.txDateTime
      if (t.txDateTime > c.lastSeen) {
        c.lastSeen = t.txDateTime
        c.lastOpType = t.type
        c.lastOpAmount = amt
        c.lastOpCurrency = t.currency
      }
    }

    const data = Array.from(map.values()).map(c => {
      const balance: Record<string, number> = {}
      const currencies = Array.from(c.currencies)
      for (const cur of currencies) {
        balance[cur] = (c.depositSum[cur] || 0) - (c.withdrawalSum[cur] || 0)
      }
      const totalOps = c.depositCount + c.withdrawalCount
      const trustScore = totalOps > 0
        ? Math.max(0, Math.round((c.matchedCount / totalOps) * 100 - (c.discrepancyCount / totalOps) * 20))
        : 0

      return {
        name: c.name,
        accountIds: Array.from(c.accounts),
        accountLabels: Array.from(c.accountLabels),
        currencies,
        depositCount: c.depositCount,
        depositSum: c.depositSum,
        withdrawalCount: c.withdrawalCount,
        withdrawalSum: c.withdrawalSum,
        balance,
        discrepancyCount: c.discrepancyCount,
        matchedCount: c.matchedCount,
        pendingCount: c.pendingCount,
        totalOps,
        trustScore,
        firstSeen: c.firstSeen.toISOString(),
        lastSeen: c.lastSeen.toISOString(),
        lastOpType: c.lastOpType,
        lastOpAmount: c.lastOpAmount,
        lastOpCurrency: c.lastOpCurrency,
      }
    })

    data.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
