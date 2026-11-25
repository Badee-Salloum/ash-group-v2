import { ShamCashRow } from '@/types'
import * as XLSX from 'xlsx'

function normalizeText(value: unknown): string {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/\s+/g, ' ').trim()
}

function parseAmount(value: unknown): number {
  const text = String(value ?? '').trim()
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/٬/g, ',').replace(/٫/g, '.')
  // The unused direction may be blank. Invalid text must never become zero.
  if (!text) return 0
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) {
    throw new Error('مبلغ غير صالح')
  }
  const amount = Number(text.replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount >= 10 ** 13) throw new Error('مبلغ خارج النطاق')
  return amount
}

// Sham Cash files are always in Syria local time (UTC+3).
// We anchor the timestamp to +03:00 so it's stored correctly as an absolute UTC instant,
// and renders back to 02:20 for a Syrian viewer (instead of being off by 3 hours).
const SYRIA_TZ_OFFSET = '+03:00'

function parseDateTime(dateStr: string, timeStr: string): Date {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timeStr)
  if (!date || !time) throw new Error('تاريخ أو وقت غير صالح')
  const [, y, m, day] = date
  const [, hh, mm, ss = '00'] = time
  const d = new Date(`${y}-${m}-${day}T${hh.padStart(2, '0')}:${mm}:${ss}${SYRIA_TZ_OFFSET}`)
  const wallClock = new Date(d.getTime() + 3 * 3_600_000)
  if (!Number.isFinite(d.getTime()) || wallClock.getUTCFullYear() !== Number(y)
    || wallClock.getUTCMonth() + 1 !== Number(m) || wallClock.getUTCDate() !== Number(day)
    || wallClock.getUTCHours() !== Number(hh) || wallClock.getUTCMinutes() !== Number(mm)
    || wallClock.getUTCSeconds() !== Number(ss)) throw new Error('تاريخ أو وقت غير صالح')
  return d
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

  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
    .map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeText(key), value])))
  if (data.length === 0) throw new Error('ملف شام كاش فارغ')

  // Check required columns
  const required = ['رقم العملية', 'نوع العملية', 'التاريخ', 'الوقت', 'العملة', 'المبلغ المستلم', 'المبلغ المدفوع']
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

    const typeRaw = normalizeText(row['نوع العملية'])
    const dateStr = String(row['التاريخ'] ?? '').trim()
    const timeStr = String(row['الوقت'] ?? '').trim()

    if (!typeRaw || !dateStr || !timeStr) {
      errors.push(`صف ${i + 2}: بيانات ناقصة`)
      continue
    }

    if (seenTxIds.has(txId)) {
      errors.push(`صف ${i + 2}: رقم عملية مكرر ${txId}`)
      continue
    }
    seenTxIds.add(txId)

    const type = ({ استلام: 'DEPOSIT', استقبال: 'DEPOSIT', ارسال: 'WITHDRAWAL' } as const)[typeRaw as 'استلام' | 'استقبال' | 'ارسال']
    if (!type) {
      errors.push(`صف ${i + 2}: نوع العملية غير معروف: ${typeRaw}`)
      continue
    }

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
    } else if (typeof dateVal === 'number') {
      const date = XLSX.SSF.parse_date_code(dateVal)
      if (date) finalDateStr = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
    }
    if (timeVal instanceof Date) {
      const hh = String(timeVal.getUTCHours()).padStart(2, '0')
      const mm = String(timeVal.getUTCMinutes()).padStart(2, '0')
      const ss = String(timeVal.getUTCSeconds()).padStart(2, '0')
      finalTimeStr = `${hh}:${mm}:${ss}`
    } else if (typeof timeVal === 'number' && timeVal >= 0 && timeVal < 1) {
      const seconds = Math.round(timeVal * 86_400)
      finalTimeStr = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    }

    try {
      const receivedAmount = parseAmount(row['المبلغ المستلم'])
      const sentAmount = parseAmount(row['المبلغ المدفوع'])
      const activeAmount = row[type === 'DEPOSIT' ? 'المبلغ المستلم' : 'المبلغ المدفوع']
      if (activeAmount === undefined || activeAmount === null || String(activeAmount).trim() === '') throw new Error('المبلغ المطلوب مفقود')
      if ((type === 'DEPOSIT' && receivedAmount === 0 && sentAmount > 0)
        || (type === 'WITHDRAWAL' && sentAmount === 0 && receivedAmount > 0)) throw new Error('نوع العملية لا يتفق مع عمود المبلغ')
      const currency = normalizeText(row['العملة']).toUpperCase()
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('العملة مفقودة أو غير صالحة')
      rows.push({
        txId,
        type,
        receivedAmount,
        sentAmount,
        currency,
        date: finalDateStr,
        time: finalTimeStr,
        txDateTime: parseDateTime(finalDateStr, finalTimeStr),
        accountNumber: String(row['رقم حساب'] || '').trim(),
        accountName: String(row['اسم حساب'] || '').trim(),
        notes: String(row['ملاحظات'] || '').trim(),
      })
    } catch (error) {
      errors.push(`صف ${i + 2}: ${error instanceof Error ? error.message : 'بيانات غير صالحة'}`)
    }
  }

  return { rows, errors }
}
