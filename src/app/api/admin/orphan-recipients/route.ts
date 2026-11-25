import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireRole } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { UserRole, TransactionStatus, TransactionSource, TransactionType } from '@/lib/db/prisma-types'
import { isOpsBearer } from '@/lib/auth/opsToken'
import { damascusDayStartUtc, addDays } from '@/lib/datetime'

// Who is actually receiving the SC-only withdrawals?
//
// A withdrawal stuck as PENDING_SC means money left Sham Cash with no matching
// platform payout order. In aggregate these are noise — but grouped by
// recipient they usually tell a clear story: a handful of accounts (company
// settlement wallets, cash-out agents) dominate, while genuine customers
// appear once or twice.
//
// Recipients that turn out to be our own wallets belong in the account's
// walletIdentifiers, after which isInternalTransfer() tags them on ingest and
// they stop landing in the review queue at all. Recipients that DON'T belong
// there are the ones worth investigating.
//
// Read-only. ADMIN session OR ops Bearer.
// GET /api/admin/orphan-recipients?from=2026-08-01&to=2026-08-31&accountName=X&top=15
export const maxDuration = 120

export async function GET(req: NextRequest) {
  try {
    if (!isOpsBearer(req)) {
      const session = await getSession()
      if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
      requireRole(session, [UserRole.ADMIN])
    }

    const p = req.nextUrl.searchParams
    const nameFilter = p.get('accountName') || undefined
    const from = p.get('from') || undefined
    const to = p.get('to') || undefined
    const top = Math.min(50, Math.max(1, parseInt(p.get('top') || '15', 10)))
    const dateWindow = from && to
      ? { gte: damascusDayStartUtc(from), lt: damascusDayStartUtc(addDays(to, 1)) }
      : undefined

    const accounts = await db.account.findMany({
      where: nameFilter ? { name: { contains: nameFilter, mode: 'insensitive' } } : {},
      select: { id: true, name: true, walletIdentifiers: true },
      orderBy: { name: 'asc' },
    })

    const perAccount = await Promise.all(accounts.map(async (a: {
      id: string; name: string; walletIdentifiers: string[]
    }) => {
      const rows: Array<{
        amount: unknown; rawData: unknown; notes: string | null; reviewCategory: string | null
      }> = await db.transaction.findMany({
        where: {
          accountId: a.id,
          source: TransactionSource.SHAM_CASH,
          type: TransactionType.WITHDRAWAL,
          status: TransactionStatus.PENDING_SC,
          matchedTxId: null,
          ...(dateWindow ? { txDateTime: dateWindow } : {}),
        },
        select: { amount: true, rawData: true, notes: true, reviewCategory: true },
      })

      // Group by the SC-side counterparty (account number is the stable key;
      // the display name can vary in spelling between exports).
      const byRecipient = new Map<string, {
        key: string; name: string; count: number; total: number
        internalTransferTagged: number
      }>()
      let noRawData = 0
      // The ingest pipeline already tags own-wallet sends with
      // notes='internal-transfer' but still stores them as PENDING_SC, so a
      // raw PENDING_SC count badly overstates how much is genuinely orphaned.
      let taggedInternal = 0
      let genuinelyOrphan = 0
      for (const r of rows) {
        const isTagged = String(r.notes || '') === 'internal-transfer'
        if (isTagged) taggedInternal++; else genuinelyOrphan++
        const raw = r.rawData as { accountNumber?: string; accountName?: string } | null
        if (!raw || typeof raw !== 'object') { noRawData++; continue }
        const key = String(raw.accountNumber || '').trim() || '(unknown)'
        const name = String(raw.accountName || '').trim() || '(unknown)'
        let e = byRecipient.get(key)
        if (!e) { e = { key, name, count: 0, total: 0, internalTransferTagged: 0 }; byRecipient.set(key, e) }
        e.count++
        e.total += Number(r.amount || 0)
        if (isTagged) e.internalTransferTagged++
      }

      const ranked = Array.from(byRecipient.values())
        .sort((x, y) => y.count - x.count)
        .slice(0, top)
        .map(e => ({
          accountNumber: e.key,
          accountName: e.name,
          count: e.count,
          internalTransferTagged: e.internalTransferTagged,
          totalAmount: Math.round(e.total * 100) / 100,
          shareOfOrphans: rows.length ? Math.round((e.count / rows.length) * 1000) / 10 : 0,
          // Would adding this recipient to walletIdentifiers already have
          // caught it? (i.e. is it a config gap rather than a new discovery)
          alreadyInWalletIdentifiers: a.walletIdentifiers.some(w =>
            e.key.includes(w) || e.name.toLowerCase().includes(w.toLowerCase()),
          ),
        }))

      const totalAmount = rows.reduce((s: number, r: { amount: unknown }) => s + Number(r.amount || 0), 0)

      return {
        accountId: a.id,
        name: a.name,
        walletIdentifiers: a.walletIdentifiers,
        pendingScCount: rows.length,
        taggedInternalTransfer: taggedInternal,
        orphanCount: genuinelyOrphan,
        orphanTotalAmount: Math.round(totalAmount * 100) / 100,
        distinctRecipients: byRecipient.size,
        rowsWithoutRawData: noRawData,
        topRecipients: ranked,
      }
    }))

    const grandTotal = perAccount.reduce((s, a) => s + a.orphanTotalAmount, 0)
    const grandCount = perAccount.reduce((s, a) => s + a.orphanCount, 0)

    return NextResponse.json({
      ok: true,
      window: dateWindow ? { from, to } : null,
      accountsScanned: accounts.length,
      grandCount,
      grandTotalAmount: Math.round(grandTotal * 100) / 100,
      perAccount: perAccount.filter(a => a.orphanCount > 0),
    })
  } catch (e) {
    if (e instanceof Error && e.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 })
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
