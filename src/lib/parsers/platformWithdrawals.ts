import { PlatformWithdrawalRow } from '@/types'
import { parseStringPromise } from 'xml2js'
import { extractShamCashTxId } from './platformDeposits'

// epayquery.xls is SpreadsheetML (XML) not real XLS
// We parse it as XML directly

function getText(cell: Record<string, unknown>): string {
  const data = (cell as Record<string, unknown[]>)['Data']
  if (!data || !data[0]) return ''
  const d = data[0] as Record<string, unknown>
  if (typeof d === 'string') return d
  if (d['_']) return String(d['_'])
  return ''
}

// Platform withdrawal times are in Syria local time (UTC+3).
// Anchor to +03:00 if no timezone is present to avoid UTC misinterpretation on Vercel.
const SYRIA_TZ_OFFSET = '+03:00'

function hasTimezone(s: string): boolean {
  return /([Zz]|[+\-]\d{2}:?\d{2})$/.test(s.trim())
}

function parseDateTime(val: string): Date | null {
  if (!val) return null
  const s = String(val).trim()
  const normalized = s.replace(' ', 'T')
  const withTz = hasTimezone(normalized) ? normalized : `${normalized}${SYRIA_TZ_OFFSET}`
  const d = new Date(withTz)
  return isNaN(d.getTime()) ? null : d
}

export async function parsePlatformWithdrawalsFile(buffer: Buffer | ArrayBuffer): Promise<{
  rows: PlatformWithdrawalRow[]
  errors: string[]
}> {
  const rows: PlatformWithdrawalRow[] = []
  const errors: string[] = []

  // Check if it's a ZIP file (xlsx) by looking at magic bytes: PK (0x50 0x4B)
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const isZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4B

  if (!isZip) {
    // Not a ZIP — try as SpreadsheetML XML
    const content = buf.toString('utf-8').trim()
    if (content.includes('<?xml') || content.includes('<Workbook')) {
      return parseSpreadsheetML(content)
    }
  }

  // Try as XLSX using ExcelJS
  try {
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as any)
    const ws = workbook.worksheets[0]
    if (!ws) throw new Error('no sheet')

    const colMap: Record<string, number> = {}
    ws.getRow(1).eachCell((cell, i) => {
      colMap[String(cell.value || '').trim()] = i
    })

    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return
      try {
        const txId = String(row.getCell(colMap['Transaction ID'] || 1).value || '').trim()
        if (!txId) return

        const payoutVal = row.getCell(colMap['Time of payout'] || 7).value
        const withdrawalVal = row.getCell(colMap['Time of withdrawal'] || 6).value

        const wdTime = withdrawalVal instanceof Date ? withdrawalVal : parseDateTime(String(withdrawalVal || ''))
        const payoutTime = payoutVal instanceof Date ? payoutVal : parseDateTime(String(payoutVal || ''))
        const finalPayoutTime = payoutTime || wdTime
        if (!finalPayoutTime) {
          errors.push(`صف ${rowNum}: لا يحتوي تاريخ صالح للسحب`)
          return
        }

        const userInfo = String(row.getCell(colMap['User info'] || 12).value || '').trim()
        rows.push({
          txId,
          userId: String(row.getCell(colMap['User ID'] || 2).value || '').trim(),
          amount: parseFloat(String(row.getCell(colMap['Amount'] || 5).value || '0')) || 0,
          currency: String(row.getCell(colMap['Currency'] || 4).value || 'USD').trim(),
          status: String(row.getCell(colMap['Status'] || 3).value || '').trim(),
          withdrawalTime: wdTime || finalPayoutTime,
          payoutTime: finalPayoutTime,
          userInfo,
          bankName: String(row.getCell(colMap['Bank name'] || 9).value || '').trim(),
          provider: String(row.getCell(colMap['Provider'] || 10).value || '').trim(),
          payoutConfirmation: String(row.getCell(colMap['Payout confirmation'] || 13).value || '').trim(),
          shamCashTxId: extractShamCashTxId(userInfo),
        })
      } catch (e) {
        errors.push(`صف ${rowNum}: خطأ في المعالجة - ${e}`)
      }
    })
  } catch (e) {
    errors.push(`تعذر قراءة ملف السحوبات: ${e}`)
  }

  return { rows, errors }
}

// The platform exports "epayquery.xls" as SpreadsheetML XML but does NOT
// escape `&` characters inside URLs (e.g. payout_confirmation paths) — that
// violates XML spec and breaks xml2js. We sanitize before parsing: replace
// any `&` not already part of an entity (`&amp;`, `&lt;`, `&#123;`, etc.)
// with `&amp;`.
function sanitizeSpreadsheetMLXml(xml: string): string {
  return xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
}

async function parseSpreadsheetML(content: string): Promise<{
  rows: PlatformWithdrawalRow[]
  errors: string[]
}> {
  const rows: PlatformWithdrawalRow[] = []
  const errors: string[] = []

  try {
    const safeContent = sanitizeSpreadsheetMLXml(content)
    const result = await parseStringPromise(safeContent, {
      explicitArray: true,
      tagNameProcessors: [(name) => name.replace(/^.*:/, '')],
    })

    const workbook = result['Workbook']
    const worksheet = workbook?.['Worksheet']?.[0]
    const table = worksheet?.['Table']?.[0]
    const xmlRows: unknown[] = table?.['Row'] || []

    if (xmlRows.length === 0) return { rows, errors }

    // Parse header row
    const headerRow = xmlRows[0] as Record<string, unknown[]>
    const headerCells: string[] = (headerRow['Cell'] || []).map((c) => {
      const cell = c as Record<string, unknown[]>
      const data = cell['Data']?.[0]
      if (!data) return ''
      if (typeof data === 'string') return data
      const d = data as Record<string, unknown>
      return String(d['_'] || '')
    })

    const colIdx: Record<string, number> = {}
    headerCells.forEach((h, i) => { colIdx[h.trim()] = i })

    // Parse data rows
    for (let r = 1; r < xmlRows.length; r++) {
      const xmlRow = xmlRows[r] as Record<string, unknown[]>
      const cells: string[] = []

      const cellList = xmlRow['Cell'] || []
      let currentIdx = 0
      for (const c of cellList) {
        const cell = c as Record<string, unknown>
        // Handle ss:Index for sparse cells
        const attrs = (cell['$'] as Record<string, string>) || {}
        const ssIndex = attrs['ss:Index'] || attrs['Index']
        if (ssIndex) currentIdx = parseInt(ssIndex) - 1

        const dataArr = (cell as Record<string, unknown[]>)['Data'] || []
        const dataItem = dataArr[0]
        let val = ''
        if (typeof dataItem === 'string') val = dataItem
        else if (dataItem) {
          const d = dataItem as Record<string, unknown>
          val = String(d['_'] || '')
        }
        cells[currentIdx] = val
        currentIdx++
      }

      const get = (colName: string) => cells[colIdx[colName]] || ''

      const txId = get('Transaction ID')
      if (!txId) continue

      const wdTime = parseDateTime(get('Time of withdrawal'))
      const payoutTime = parseDateTime(get('Time of payout'))
      const finalPayoutTime = payoutTime || wdTime
      if (!finalPayoutTime) continue
      const userInfo = get('User info')
      rows.push({
        txId,
        userId: get('User ID'),
        amount: parseFloat(get('Amount')) || 0,
        currency: get('Currency') || 'USD',
        status: get('Status'),
        withdrawalTime: wdTime || finalPayoutTime,
        payoutTime: finalPayoutTime,
        userInfo,
        bankName: get('Bank name'),
        provider: get('Provider'),
        payoutConfirmation: get('Payout confirmation'),
        shamCashTxId: extractShamCashTxId(userInfo),
      })
    }
  } catch (e) {
    errors.push(`خطأ في تحليل ملف SpreadsheetML: ${e}`)
  }

  return { rows, errors }
}
