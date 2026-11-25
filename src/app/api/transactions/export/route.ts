import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'
import ExcelJS from 'exceljs'
import { PassThrough, Readable } from 'node:stream'
import { TransactionStatus, TransactionType, UserRole } from '@/lib/db/prisma-types'

export const runtime = 'nodejs'

// The writer commits each row immediately and every database request is
// keyset-paginated. Exports therefore have bounded application memory even
// when an account has millions of transactions.
const EXPORT_BATCH_SIZE = 2_000

const STATUS_AR: Record<TransactionStatus, string> = {
  MATCHED: 'مطابقة صحيحة',
  PENDING_SC: 'شام كاش فقط',
  PENDING_P: 'المنصة فقط',
  DISCREPANCY: 'فارق في المبلغ',
  WASTE: 'هدر',
  RETURNS: 'مرتجعات',
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 })
    if (session.role === UserRole.EMPLOYEE) {
      return NextResponse.json({ error: 'لا تملك صلاحية' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') as TransactionStatus | null
    const type = searchParams.get('type') as TransactionType | null
    const accountId = searchParams.get('accountId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const where: Record<string, unknown> = {}

    if (session.role === UserRole.ACCOUNT_MGR) {
      const access = await db.accountAccess.findMany({
        where: { userId: session.userId },
        select: { accountId: true },
      })
      where.accountId = { in: access.map((row: { accountId: string }) => row.accountId) }
    } else if (accountId) {
      where.accountId = accountId
    }
    if (status) where.status = status
    if (type) where.type = type
    if (dateFrom || dateTo) {
      where.txDateTime = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
      }
    }

    const output = new PassThrough()
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: output,
      useStyles: true,
      useSharedStrings: false,
    })
    const worksheet = workbook.addWorksheet('المعاملات', { views: [{ rightToLeft: true }] })
    worksheet.columns = [
      { header: 'رقم العملية (شام كاش)', key: 'shamCashTxId', width: 22 },
      { header: 'رقم العملية (المنصة)', key: 'platformTxId', width: 22 },
      { header: 'معرّف المستخدم', key: 'platformUserId', width: 16 },
      { header: 'الحساب', key: 'account', width: 28 },
      { header: 'اسم الحساب (شام كاش)', key: 'customerName', width: 28 },
      { header: 'النوع', key: 'type', width: 12 },
      { header: 'المصدر', key: 'source', width: 14 },
      { header: 'المبلغ', key: 'amount', width: 14 },
      { header: 'العملة', key: 'currency', width: 10 },
      { header: 'الحالة', key: 'status', width: 20 },
      { header: 'الفارق', key: 'amountDiff', width: 12 },
      { header: 'التاريخ والوقت', key: 'txDateTime', width: 20 },
    ]
    const header = worksheet.getRow(1)
    header.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 }
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
    })
    header.height = 28
    worksheet.autoFilter = { from: 'A1', to: 'L1' }

    const writeWorkbook = async () => {
      let cursor: { txDateTime: Date; id: string } | undefined
      let rowIndex = 0
      try {
        for (;;) {
          const pageWhere: Record<string, unknown> = cursor
            ? {
                AND: [
                  where,
                  {
                    OR: [
                      { txDateTime: { lt: cursor.txDateTime } },
                      { txDateTime: cursor.txDateTime, id: { lt: cursor.id } },
                    ],
                  },
                ],
              }
            : where
          const transactions = await db.transaction.findMany({
            where: pageWhere,
            select: {
              id: true,
              shamCashTxId: true,
              platformTxId: true,
              platformUserId: true,
              customerName: true,
              type: true,
              source: true,
              amount: true,
              currency: true,
              status: true,
              amountDiff: true,
              txDateTime: true,
              account: { select: { name: true } },
            },
            orderBy: [{ txDateTime: 'desc' }, { id: 'desc' }],
            take: EXPORT_BATCH_SIZE,
          })
          if (transactions.length === 0) break

          for (const tx of transactions) {
            const row = worksheet.addRow({
              shamCashTxId: tx.shamCashTxId || '—',
              platformTxId: tx.platformTxId || '—',
              platformUserId: tx.platformUserId || '—',
              account: tx.account.name,
              // Normalized at import/backfill time; do not read rawData here.
              customerName: tx.customerName || '',
              type: tx.type === 'DEPOSIT' ? 'إيداع' : 'سحب',
              source: tx.source === 'SHAM_CASH' ? 'شام كاش' : 'المنصة',
              amount: Number(tx.amount),
              currency: tx.currency,
              status: STATUS_AR[tx.status as TransactionStatus] || String(tx.status),
              amountDiff: tx.amountDiff ? Number(tx.amountDiff) : '',
              txDateTime: new Date(tx.txDateTime).toLocaleString('ar-SY'),
            })
            if (rowIndex % 2 === 0) {
              row.eachCell(cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
              })
            }
            row.eachCell(cell => { cell.alignment = { horizontal: 'right' } })
            row.commit()
            rowIndex++
          }

          const last = transactions[transactions.length - 1]
          cursor = { txDateTime: last.txDateTime, id: last.id }
          if (transactions.length < EXPORT_BATCH_SIZE) break
        }
        worksheet.commit()
        await workbook.commit()
      } catch (error) {
        output.destroy(error instanceof Error ? error : new Error(String(error)))
      }
    }

    void writeWorkbook()
    return new NextResponse(Readable.toWeb(output) as unknown as ReadableStream<Uint8Array>, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="transactions_${Date.now()}.xlsx"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
