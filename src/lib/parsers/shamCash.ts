import { ShamCashRow } from '@/types'
import * as XLSX from 'xlsx'

function parseAmount(val: string): number {
  if (!val || val === '00.00' || val === '0') return 0
  const cleaned = val.replace(/,/g, '').trim()
  return parseFloat(cleaned) || 0
}

// Sham Cash files are always in Syria local time (UTC+3).
// We anchor the timestamp to +03:00 so it's stored correctly as an absolute UTC instant,
// and renders back to 02:20 for a Syrian viewer (instead of being off by 3 hours).
const SYRIA_TZ_OFFSET = '+03:00'

function parseDateTime(dateStr: string, timeStr: string): Date {
  try {
    // Normalize time to HH:MM:SS
    const t = timeStr.includes(':') ? timeStr : `${timeStr}:00`
    const combined = `${dateStr}T${t}${SYRIA_TZ_OFFSET}`
    const d = new Date(combined)
    if (!isNaN(d.getTime())) return d
  } catch {}
  return new Date()
}

export async function parseShamCashFile(buffer: Buffer | ArrayBuffer): Promise<{
  rows: ShamCashRow[]
  errors: string[]
}> {
  const rows: ShamCashRow[] = []
  const errors: string[] = []

  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const wb = XLSX.read(buf, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('الملف لا يحتوي على بيانات')

  const data: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
  if (data.length === 0) throw new Error('ملف شام كاش فارغ')

  // Check required columns
  const required = ['رقم العملية', 'نوع العملية', 'التاريخ', 'الوقت']
  const firstRow = data[0]
  const missing = required.filter(c => !(c in firstRow))
  if (missing.length > 0) {
    throw new Error(`أعمدة مفقودة في ملف شام كاش: ${missing.join(', ')}`)
  }

  const seenTxIds = new Set<string>()

  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    const txId = String(row['رقم العملية'] || '').trim()
    if (!txId) continue

    const typeRaw = String(row['نوع العملية'] || '').trim()
    const dateStr = String(row['التاريخ'] || '').trim()
    const timeStr = String(row['الوقت'] || '').trim()

    if (!typeRaw || !dateStr || !timeStr) {
      errors.push(`صف ${i + 2}: بيانات ناقصة`)
      continue
    }

    if (seenTxIds.has(txId)) {
      errors.push(`صف ${i + 2}: رقم عملية مكرر ${txId}`)
      continue
    }
    seenTxIds.add(txId)

    const type: 'DEPOSIT' | 'WITHDRAWAL' = typeRaw === 'استقبال' ? 'DEPOSIT' : 'WITHDRAWAL'

    // Handle date: could be Date object from Excel or string.
    // Excel stores dates without timezone info. SheetJS may return a JS Date that's
    // already shifted by server TZ. We read the "wall clock" fields (UTC getters)
    // to preserve the original value written in the file.
    let finalDateStr = dateStr
    let finalTimeStr = timeStr
    const dateVal = row['التاريخ']
    const timeVal = row['الوقت']
    if (dateVal instanceof Date) {
      const y = dateVal.getUTCFullYear()
      const m = String(dateVal.getUTCMonth() + 1).padStart(2, '0')
      const d = String(dateVal.getUTCDate()).padStart(2, '0')
      finalDateStr = `${y}-${m}-${d}`
    }
    if (timeVal instanceof Date) {
      const hh = String(timeVal.getUTCHours()).padStart(2, '0')
      const mm = String(timeVal.getUTCMinutes()).padStart(2, '0')
      const ss = String(timeVal.getUTCSeconds()).padStart(2, '0')
      finalTimeStr = `${hh}:${mm}:${ss}`
    }

    rows.push({
      txId,
      type,
      receivedAmount: parseAmount(String(row['المبلغ المستلم'] || '0')),
      sentAmount: parseAmount(String(row['المبلغ المدفوع'] || '0')),
      currency: String(row['العملة'] || 'USD').trim() || 'USD',
      date: finalDateStr,
      time: finalTimeStr,
      txDateTime: parseDateTime(finalDateStr, finalTimeStr),
      accountNumber: String(row['رقم حساب'] || '').trim(),
      accountName: String(row['اسم حساب'] || '').trim(),
      notes: String(row['ملاحظات'] || '').trim(),
    })
  }

  return { rows, errors }
}
