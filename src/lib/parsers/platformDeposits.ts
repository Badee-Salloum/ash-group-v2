import { PlatformDepositRow } from '@/types'
import * as XLSX from 'xlsx'

// Regex patterns to extract Sham Cash TX ID from "User info" field.
// Supports BOTH the old Arabic format AND the new English keys used by newer
// exports:
//   - Old: "معرف عملية شام كاش 123456" or "رقم العملية 123456"
//   - New: "ext_trn_id: 192901370, رقم الحساب البنكي ..."
const SC_TX_ID_PATTERNS = [
  /ext_trn_id\s*[:：]?\s*(\d+)/i,                                   // new deposits format
  /BankTranfer?Comment\s*[:：]?\s*(\d+)/i,                          // new withdrawals format (also used occasionally in deposits)
  /(?:معرف\s*عملية\s*شام\s*كاش|رقم\s*العملية)[^\d]*(\d+)/i,         // legacy Arabic format
]

export function extractShamCashTxId(userInfo: string): string | null {
  if (!userInfo) return null
  for (const re of SC_TX_ID_PATTERNS) {
    const m = userInfo.match(re)
    if (m) return m[1].trim()
  }
  return null
}

// Platform files are also in Syria local time (UTC+3).
// If the string has no timezone, anchor to +03:00 to avoid UTC misinterpretation
// on servers that run in UTC (Vercel).
const SYRIA_TZ_OFFSET = '+03:00'

function hasTimezone(s: string): boolean {
  return /([Zz]|[+\-]\d{2}:?\d{2})$/.test(s.trim())
}

function parseDate(val: unknown): Date | null {
  if (val === undefined || val === null || val === '') return null
  if (val instanceof Date) {
    // Build a Syria-time Date from the raw UTC fields written by Excel
    const y = val.getUTCFullYear()
    const m = String(val.getUTCMonth() + 1).padStart(2, '0')
    const d = String(val.getUTCDate()).padStart(2, '0')
    const hh = String(val.getUTCHours()).padStart(2, '0')
    const mm = String(val.getUTCMinutes()).padStart(2, '0')
    const ss = String(val.getUTCSeconds()).padStart(2, '0')
    const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}${SYRIA_TZ_OFFSET}`
    const parsed = new Date(iso)
    return isNaN(parsed.getTime()) ? val : parsed
  }
  const s = String(val).trim()
  // Accept "YYYY-MM-DD HH:mm:ss" by converting space to T
  const normalized = s.replace(' ', 'T')
  const withTz = hasTimezone(normalized) ? normalized : `${normalized}${SYRIA_TZ_OFFSET}`
  const d = new Date(withTz)
  return isNaN(d.getTime()) ? null : d
}

export async function parsePlatformDepositsFile(buffer: Buffer | ArrayBuffer): Promise<{
  rows: PlatformDepositRow[]
  errors: string[]
}> {
  const rows: PlatformDepositRow[] = []
  const errors: string[] = []

  try {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
    const wb = XLSX.read(buf, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) throw new Error('ملف الإيداعات لا يحتوي على بيانات')

    const data: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
    if (data.length === 0) throw new Error('ملف الإيداعات فارغ')

    // Check required columns
    const firstRow = data[0]
    const required = ['Transaction ID', 'User ID', 'Amount', 'Time of deposit', 'User info']
    const missing = required.filter(c => !(c in firstRow))
    if (missing.length > 0) {
      throw new Error(`أعمدة مفقودة في ملف الإيداعات: ${missing.join(', ')}`)
    }

    const seenIds = new Set<string>()

    for (let i = 0; i < data.length; i++) {
      const row = data[i]
      try {
        const txId = String(row['Transaction ID'] || '').trim()
        if (!txId) continue

        if (seenIds.has(txId)) {
          errors.push(`صف ${i + 2}: Transaction ID مكرر ${txId}`)
          continue
        }
        seenIds.add(txId)

        const userInfo = String(row['User info'] || '')
        const amount = parseFloat(String(row['Amount'] || '0')) || 0

        // Fallback order: depositTime ← createdAt ← depositTime → now (last resort)
        const depositTime = parseDate(row['Time of deposit'])
        const createdAt = parseDate(row['Date of creation'])
        // If Time of deposit is missing, use Date of creation; else current time as absolute fallback
        const finalDepositTime = depositTime || createdAt
        if (!finalDepositTime) {
          errors.push(`صف ${i + 2}: لا يحتوي تاريخ صالح للإيداع`)
          continue
        }
        rows.push({
          txId,
          userId: String(row['User ID'] || '').trim(),
          amount,
          currency: String(row['Currency'] || 'USD').trim() || 'USD',
          status: String(row['Status'] || '').trim(),
          bankName: String(row['Bank name'] || '').trim(),
          provider: String(row['Provider'] || '').trim(),
          // If Date of creation is missing (common after client-side cleaning), fall back to Time of deposit
          createdAt: createdAt || finalDepositTime,
          depositTime: finalDepositTime,
          userInfo,
          shamCashTxId: extractShamCashTxId(userInfo),
          admin: String(row['Admin'] || '').trim(),
        })
      } catch (e) {
        errors.push(`صف ${i + 2}: خطأ في المعالجة - ${e}`)
      }
    }
  } catch (e) {
    if (rows.length === 0) {
      errors.push(`تعذر قراءة ملف الإيداعات: ${e}`)
    }
  }

  return { rows, errors }
}
