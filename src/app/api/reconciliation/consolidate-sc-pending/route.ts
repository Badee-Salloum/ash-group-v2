import { NextResponse } from 'next/server'
import { getSession, requireRole, audit } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole, TransactionStatus, TransactionSource } from '@/lib/db/prisma-types'
import { createId } from '@paralleldrive/cuid2'

// Consolidates PENDING_SC operations by (accountId, accountName, type, currency)
// Each group becomes 1 summary transaction with the sum of amounts
// EXCLUDES internal transfers (matching wallet identifiers)
export async function POST() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    requireRole(session, [UserRole.ADMIN])

    // Fetch all accounts with their wallet identifiers
    const accounts = await db.account.findMany({ select: { id: true, walletIdentifiers: true } })
    const walletByAccount = new Map<string, string[]>()
    for (const a of accounts) walletByAccount.set(a.id, a.walletIdentifiers || [])

    const matchesWallet = (walletIds: string[], accNum: string, accName: string, notes: string) => {
      if (!walletIds || walletIds.length === 0) return false
      const text = `${accNum} ${accName} ${notes}`.toLowerCase()
      return walletIds.some(wid => {
        const words = wid.trim().split(/\s+/).filter(Boolean)
        if (words.length === 0) return false
        const textTokens = new Set(text.split(/\s+/).filter(Boolean))
        return words.every(word => {
          const w = word.toLowerCase()
          return w.length >= 2 ? text.includes(w) : textTokens.has(w)
        })
      })
    }

    // Fetch all PENDING_SC SHAM_CASH transactions
    const allPending = await db.transaction.findMany({
      where: { status: TransactionStatus.PENDING_SC, source: TransactionSource.SHAM_CASH, matchedTxId: null },
      select: { id: true, accountId: true, type: true, currency: true, amount: true, rawData: true, txDateTime: true, batchId: true },
    })

    // Filter out internal transfers
    const externalPending = allPending.filter((t: typeof allPending[0]) => {
      const raw = t.rawData as Record<string, unknown> | null
      if (!raw) return true
      const accNum = String(raw.accountNumber || '')
      const accName = String(raw.accountName || '')
      const notes = String(raw.notes || '')
      const walletIds = walletByAccount.get(t.accountId) || []
      return !matchesWallet(walletIds, accNum, accName, notes)
    })

    // Group by (accountId + accountName + currency) — NOT by type
    // Net = sum(deposits) - sum(withdrawals)
    type Group = { items: typeof externalPending; deposits: number; withdrawals: number }
    const groups = new Map<string, Group>()
    for (const t of externalPending) {
      const raw = t.rawData as Record<string, unknown> | null
      const accountName = String(raw?.accountName || '').trim() || 'بدون اسم'
      const key = `${t.accountId}||${accountName}||${t.currency}`
      if (!groups.has(key)) groups.set(key, { items: [], deposits: 0, withdrawals: 0 })
      const g = groups.get(key)!
      g.items.push(t)
      const amt = Number(t.amount || 0)
      if (t.type === 'DEPOSIT') g.deposits += amt
      else g.withdrawals += amt
    }

    let consolidatedCount = 0
    let removedCount = 0
    let zeroNetCount = 0

    for (const [key, g] of groups.entries()) {
      if (g.items.length < 2) continue // Skip single items
      const [accountId, accountName, currency] = key.split('||')
      const net = g.deposits - g.withdrawals
      const earliestDate = g.items.reduce((earliest: Date, t: typeof g.items[0]) => t.txDateTime < earliest ? t.txDateTime : earliest, g.items[0].txDateTime)
      const idsToDelete = g.items.map((t: typeof g.items[0]) => t.id)

      // Determine the net result type
      const operations = []

      if (Math.abs(net) < 0.01) {
        // Net is zero — just delete originals (no new transaction needed)
        await db.transaction.deleteMany({ where: { id: { in: idsToDelete } } })
        zeroNetCount++
        removedCount += g.items.length
        continue
      }

      const finalType = net > 0 ? 'DEPOSIT' : 'WITHDRAWAL'
      const finalAmount = Math.abs(net)

      operations.push(
        db.transaction.create({
          data: {
            id: createId(),
            accountId,
            batchId: g.items[0].batchId,
            source: TransactionSource.SHAM_CASH,
            type: finalType as any,
            amount: finalAmount,
            currency,
            txDateTime: earliestDate,
            status: TransactionStatus.PENDING_SC,
            notes: `[ملخص ${g.items.length} عملية: إيداع ${g.deposits.toFixed(2)} - سحب ${g.withdrawals.toFixed(2)} = صافي ${net.toFixed(2)}]`,
            rawData: {
              accountName,
              accountNumber: '—',
              notes: `consolidated net from ${g.items.length} pending operations (deposits: ${g.deposits.toFixed(2)}, withdrawals: ${g.withdrawals.toFixed(2)})`,
              consolidatedCount: g.items.length,
              consolidatedDeposits: g.deposits,
              consolidatedWithdrawals: g.withdrawals,
              netAmount: net,
              type: 'CONSOLIDATED_NET',
            } as any,
          },
        }),
        db.transaction.deleteMany({ where: { id: { in: idsToDelete } } }),
      )

      await db.$transaction(operations)
      consolidatedCount++
      removedCount += g.items.length
    }

    await audit(session.userId, 'CONSOLIDATE_PENDING_SC_NET', undefined, undefined, {
      consolidatedGroups: consolidatedCount,
      removedTransactions: removedCount,
      zeroNetGroups: zeroNetCount,
    })

    return NextResponse.json({
      success: true,
      message: `تم دمج ${removedCount} عملية في ${consolidatedCount} عملية ملخصة (+${zeroNetCount} مجموعات صافيها صفر)`,
      consolidatedGroups: consolidatedCount,
      removedTransactions: removedCount,
      zeroNetGroups: zeroNetCount,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
