import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseShamCashFile } from '@/lib/parsers/shamCash'

function buildScWorkbook(rows: Array<Record<string, string | number>>): Buffer {
  const data = [
    ['ملاحظات', 'الوقت', 'التاريخ', 'العملة', 'المبلغ المدفوع', 'المبلغ المستلم', 'اسم حساب', 'رقم حساب', 'نوع العملية', 'رقم العملية'],
    ...rows.map(r => [
      r['ملاحظات'] || '',
      r['الوقت'] ?? '12:00:00',
      r['التاريخ'] || '2026-04-28',
      r['العملة'] ?? 'USD',
      r['المبلغ المدفوع'] ?? '0',
      r['المبلغ المستلم'] ?? '0',
      r['اسم حساب'] || '',
      r['رقم حساب'] || '',
      r['نوع العملية'] || 'استقبال',
      r['رقم العملية'] || '',
    ]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

describe('parseShamCashFile — types & amounts', () => {
  it('maps استقبال → DEPOSIT', async () => {
    const buf = buildScWorkbook([
      { 'رقم العملية': '100', 'نوع العملية': 'استقبال', 'المبلغ المستلم': '50' },
    ])
    const r = await parseShamCashFile(buf)
    expect(r.errors.length).toBe(0)
    expect(r.rows[0].type).toBe('DEPOSIT')
    expect(r.rows[0].receivedAmount).toBe(50)
  })

  it('maps ارسال → WITHDRAWAL', async () => {
    const buf = buildScWorkbook([
      { 'رقم العملية': '200', 'نوع العملية': 'ارسال', 'المبلغ المدفوع': '100' },
    ])
    const r = await parseShamCashFile(buf)
    expect(r.rows[0].type).toBe('WITHDRAWAL')
    expect(r.rows[0].sentAmount).toBe(100)
  })

  it('parseAmount: "00.00" returns 0', async () => {
    const buf = buildScWorkbook([
      { 'رقم العملية': '300', 'المبلغ المدفوع': '00.00', 'المبلغ المستلم': '00.00' },
    ])
    const r = await parseShamCashFile(buf)
    expect(r.rows[0].sentAmount).toBe(0)
    expect(r.rows[0].receivedAmount).toBe(0)
  })

  it('parseAmount: "1,234" strips comma', async () => {
    const buf = buildScWorkbook([
      { 'رقم العملية': '400', 'نوع العملية': 'ارسال', 'المبلغ المدفوع': '1,234' },
    ])
    const r = await parseShamCashFile(buf)
    expect(r.rows[0].sentAmount).toBe(1234)
  })

  it('flags duplicate TX IDs as errors', async () => {
    const buf = buildScWorkbook([
      { 'رقم العملية': '500', 'المبلغ المستلم': '10' },
      { 'رقم العملية': '500', 'المبلغ المستلم': '20' },
    ])
    const r = await parseShamCashFile(buf)
    expect(r.rows.length).toBe(1)
    expect(r.errors.some(e => e.includes('500'))).toBe(true)
  })

  it('skips rows without TX ID silently', async () => {
    const buf = buildScWorkbook([
      { 'رقم العملية': '600' },
      { 'رقم العملية': '' },
    ])
    const r = await parseShamCashFile(buf)
    expect(r.rows.length).toBe(1)
  })

  it('flags rows with missing date/time as errors', async () => {
    // Build manually so the helper's defaults don't fill in date/time.
    const data = [
      ['ملاحظات', 'الوقت', 'التاريخ', 'العملة', 'المبلغ المدفوع', 'المبلغ المستلم', 'اسم حساب', 'رقم حساب', 'نوع العملية', 'رقم العملية'],
      ['', '', '', 'USD', '0', '0', '', '', 'استقبال', '700'],
    ]
    const ws = XLSX.utils.aoa_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const r = await parseShamCashFile(buf)
    expect(r.errors.length).toBeGreaterThan(0)
  })

  it('throws when required column missing', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['ملاحظات', 'الوقت'],  // missing التاريخ + رقم العملية + نوع العملية
      ['', '12:00:00'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    await expect(parseShamCashFile(buf)).rejects.toThrow(/أعمدة مفقودة/)
  })

  it('parses explicit currency and rejects missing currency instead of assuming USD', async () => {
    const buf = buildScWorkbook([
      { 'رقم العملية': '800', 'العملة': 'EUR' },
      { 'رقم العملية': '801', 'العملة': '' },
    ])
    const r = await parseShamCashFile(buf)
    expect(r.rows[0].currency).toBe('EUR')
    expect(r.rows).toHaveLength(1)
    expect(r.errors[0]).toContain('العملة')
  })

  it.each(['استلام', 'استقبال', ' اِسْتِلام ', '\u200fاستلام\u200f'])('recognizes receive label %s', async label => {
    const result = await parseShamCashFile(buildScWorkbook([
      { 'رقم العملية': 'label', 'نوع العملية': label, 'المبلغ المستلم': '10' },
    ]))
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({ type: 'DEPOSIT', receivedAmount: 10, sentAmount: 0 })
  })

  it.each(['ارسال', 'إرسال', ' إرسال '])('recognizes send label %s', async label => {
    const result = await parseShamCashFile(buildScWorkbook([
      { 'رقم العملية': 'send', 'نوع العملية': label, 'المبلغ المدفوع': '10' },
    ]))
    expect(result.errors).toEqual([])
    expect(result.rows[0].type).toBe('WITHDRAWAL')
  })

  it('rejects unknown labels rather than silently treating them as sends', async () => {
    const result = await parseShamCashFile(buildScWorkbook([
      { 'رقم العملية': 'unknown', 'نوع العملية': 'تحويل آخر', 'المبلغ المستلم': '10' },
    ]))
    expect(result.rows).toEqual([])
    expect(result.errors[0]).toContain('نوع العملية غير معروف')
  })

  it.each(['garbage', '10 USD', '1,23', '-10', 'Infinity'])('rejects invalid amount %s', async amount => {
    const result = await parseShamCashFile(buildScWorkbook([
      { 'رقم العملية': 'bad', 'نوع العملية': 'استلام', 'المبلغ المستلم': amount },
    ]))
    expect(result.rows).toEqual([])
    expect(result.errors[0]).toContain('مبلغ')
  })

  it('accepts Arabic numerals and separators without changing the value', async () => {
    const result = await parseShamCashFile(buildScWorkbook([
      { 'رقم العملية': 'arabic', 'نوع العملية': 'استلام', 'المبلغ المستلم': '١٬٢٣٤٫٥٠', 'العملة': ' usd ' },
    ]))
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({ receivedAmount: 1234.5, currency: 'USD' })
  })

  it.each([['2026-02-30', '12:00:00'], ['invalid', '12:00:00'], ['2026-10-12', '25:00:00']])('rejects invalid timestamp %s %s', async (date, time) => {
    const result = await parseShamCashFile(buildScWorkbook([
      { 'رقم العملية': 'date', 'المبلغ المستلم': '10', 'التاريخ': date, 'الوقت': time },
    ]))
    expect(result.rows).toEqual([])
    expect(result.errors[0]).toContain('تاريخ أو وقت غير صالح')
  })

  it('accepts numeric Excel dates and midnight without using the current time', async () => {
    const serial = (Date.UTC(2026, 9, 12) - Date.UTC(1899, 11, 30)) / 86_400_000
    const result = await parseShamCashFile(buildScWorkbook([
      { 'رقم العملية': 'excel', 'المبلغ المستلم': '10', 'التاريخ': serial, 'الوقت': 0 },
    ]))
    expect(result.errors).toEqual([])
    expect(result.rows[0].txDateTime.toISOString()).toBe('2026-10-11T21:00:00.000Z')
  })

  it('anchors date/time to Asia/Damascus (+03:00)', async () => {
    const buf = buildScWorkbook([
      { 'رقم العملية': '900', 'التاريخ': '2026-04-28', 'الوقت': '12:00:00' },
    ])
    const r = await parseShamCashFile(buf)
    // 12:00 Damascus = 09:00 UTC
    expect(r.rows[0].txDateTime.toISOString()).toBe('2026-04-28T09:00:00.000Z')
  })
})
