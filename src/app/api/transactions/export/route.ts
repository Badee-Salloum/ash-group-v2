import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import ExcelJS from 'exceljs'
import { TransactionStatus, TransactionType, UserRole } from '@/lib/db/prisma-types'

const STATUS_AR: Record<TransactionStatus, string> = {
  MATCHED: 'مطابقة صحيحة',
  PENDING_SC: 'شام كاش فقط',
  PENDING_P: 'المنصة فقط',
  DISCREPANCY: 'فارق في المبلغ',
  WASTE: 'هدر',
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') as TransactionStatus | null
    const type = searchParams.get('type') as TransactionType | null
    const accountId = searchParams.get('accountId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    const where: Record<string, unknown> = {}

    if (session.role === UserRole.ACCOUNT_MGR) {
      const access = await db.accountAccess.findMany({ where: { userId: session.userId } })
      where.accountId = { in: access.map((a: { accountId: string }) => a.accountId) }
    } else if (accountId) {
      where.accountId = accountId
    }

    if (status) where.status = status
    if (type) where.type = type
    if (dateFrom || dateTo) {
      where.txDateTime = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59') } : {}),
      }
    }

    const transactions = await db.transaction.findMany({
      where,
      include: {
        account: { select: { name: true } },
        matchedTx: { select: { rawData: true } },
      },
      orderBy: { txDateTime: 'desc' },
      take: 10000,
    })

    // Build Excel
    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('المعاملات', { views: [{ rightToLeft: true }] })

    ws.columns = [
      { header: 'رقم العملية (شام كاش)', key: 'shamCashTxId', width: 22 },
      { header: 'رقم العملية (المنصة)', key: 'platformTxId', width: 22 },
      { header: 'معرف المستخدم', key: 'platformUserId', width: 16 },
      { header: 'الحساب', key: 'account', width: 28 },
      { header: 'اسم الحساب (شام كاش)', key: 'scAccountName', width: 28 },
      { header: 'النوع', key: 'type', width: 12 },
      { header: 'المصدر', key: 'source', width: 14 },
      { header: 'المبلغ', key: 'amount', width: 14 },
      { header: 'العملة', key: 'currency', width: 10 },
      { header: 'الحالة', key: 'status', width: 20 },
      { header: 'الفارق', key: 'amountDiff', width: 12 },
      { header: 'التاريخ والوقت', key: 'txDateTime', width: 20 },
    ]

    // Header style
    ws.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 }
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
    })
    ws.getRow(1).height = 28

    transactions.forEach((tx: typeof transactions[0], i: number) => {
      const raw = tx.rawData as Record<string, unknown> | null
      const sc = raw?.sc as Record<string, unknown> | undefined
      const matchedRaw = (tx as any).matchedTx?.rawData as Record<string, unknown> | null
      const scAccountName = (raw?.accountName as string) || (sc?.accountName as string) || (matchedRaw?.accountName as string) || ''
      const row = ws.addRow({
        shamCashTxId: tx.shamCashTxId || '—',
        platformTxId: tx.platformTxId || '—',
        platformUserId: tx.platformUserId || '—',
        account: tx.account.name,
        scAccountName,
        type: tx.type === 'DEPOSIT' ? 'إيداع' : 'سحب',
        source: tx.source === 'SHAM_CASH' ? 'شام كاش' : 'المنصة',
        amount: Number(tx.amount),
        currency: tx.currency,
        status: (STATUS_AR as Record<string, string>)[String(tx.status)] || String(tx.status),
        amountDiff: tx.amountDiff ? Number(tx.amountDiff) : '',
        txDateTime: new Date(tx.txDateTime).toLocaleString('ar-SY'),
      })
      // Zebra striping
      if (i % 2 === 0) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
        })
      }
      row.eachCell(cell => { cell.alignment = { horizontal: 'right' } })
    })

    // Auto-filter
    ws.autoFilter = { from: 'A1', to: `L1` }

    const buffer = await workbook.xlsx.writeBuffer()
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="transactions_${Date.now()}.xlsx"`,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
