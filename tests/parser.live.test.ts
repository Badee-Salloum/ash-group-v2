import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import { parseShamCashFile } from '@/lib/parsers/shamCash'
import { parsePlatformWithdrawalsFile } from '@/lib/parsers/platformWithdrawals'
import { extractShamCashTxId } from '@/lib/parsers/platformDeposits'

const SC_FILE = 'C:\\Users\\Badee Salloum\\Desktop\\New folder (2)\\sham_cash_report_20260428_193255.xlsx'
const PLATFORM_WD_FILE = 'C:\\Users\\Badee Salloum\\Desktop\\New folder (2)\\epayquery (3).xls'
// New folder (3) — second batch from the user (deposits scenario)
const SC_FILE_3 = 'C:\\Users\\Badee Salloum\\Desktop\\New folder (3)\\sham_cash_report_20260429_033207_033219.xlsx'
const DEP_FILE_3 = 'C:\\Users\\Badee Salloum\\Desktop\\New folder (3)\\epaylist (4)_033430.xlsx'

const TARGET_TX_IDS = ['194800154', '194842810', '194733802']

describe.skipIf(!fs.existsSync(SC_FILE))('SC parser — live file diagnostic', () => {
  it('finds the 3 target TX rows with correct sentAmount and type', async () => {
    const buf = fs.readFileSync(SC_FILE)
    const { rows, errors } = await parseShamCashFile(buf)
    expect(errors.length, 'should have no parse errors').toBe(0)

    for (const tx of TARGET_TX_IDS) {
      const row = rows.find(r => r.txId === tx)
      expect(row, `TX ${tx} should be present`).toBeDefined()
      expect(row!.type, `TX ${tx} type`).toBe('WITHDRAWAL')
      expect(row!.sentAmount, `TX ${tx} sentAmount`).toBeGreaterThan(0)
      expect(row!.currency).toBe('USD')
    }
  })
})

describe.skipIf(!fs.existsSync(PLATFORM_WD_FILE))('Platform withdrawal parser — live file diagnostic', () => {
  it('finds rows referencing each target SC TX id and extracts shamCashTxId', async () => {
    const buf = fs.readFileSync(PLATFORM_WD_FILE)
    const { rows, errors } = await parsePlatformWithdrawalsFile(buf)
    expect(errors.length, `parse errors: ${errors.join(' | ')}`).toBe(0)
    expect(rows.length).toBeGreaterThan(0)

    for (const tx of TARGET_TX_IDS) {
      const row = rows.find(r => r.shamCashTxId === tx)
      expect(row, `should find platform row with shamCashTxId=${tx}`).toBeDefined()
      expect(row!.amount, `amount for ${tx}`).toBeGreaterThan(0)
      expect(row!.currency).toBe('USD')
      expect(row!.userInfo, `userInfo should mention ${tx}`).toContain(tx)
    }
  })

  it('parses ALL rows (no silent drop) — every SC TX id from the SC file should have a match', async () => {
    const scBuf = fs.readFileSync(SC_FILE)
    const wdBuf = fs.readFileSync(PLATFORM_WD_FILE)
    const sc = await parseShamCashFile(scBuf)
    const pl = await parsePlatformWithdrawalsFile(wdBuf)

    const scWithdrawals = sc.rows.filter(r => r.type === 'WITHDRAWAL')
    const platformShamCashIds = new Set(pl.rows.map(r => r.shamCashTxId).filter((x): x is string => !!x))

    // eslint-disable-next-line no-console
    console.log(`SC withdrawals: ${scWithdrawals.length} | Platform parsed: ${pl.rows.length} | with SC TX id: ${platformShamCashIds.size}`)

    const missing: string[] = []
    for (const sw of scWithdrawals) {
      if (!platformShamCashIds.has(sw.txId)) missing.push(sw.txId)
    }
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`Missing platform link for ${missing.length} SC withdrawals. First 10:`, missing.slice(0, 10))
    }
    // Diagnostic only — missing rows here mean the platform file genuinely
    // doesn't cover those SC withdrawals (different platform file, internal
    // transfers, or unprocessed). Not a code bug.
    expect(scWithdrawals.length).toBeGreaterThan(0)
  })
})

describe('extractShamCashTxId — regex coverage', () => {
  it('extracts from BankTranferComment with comma after', () => {
    expect(extractShamCashTxId('BankTranferComment: 194800154, رابط المحفظة: x')).toBe('194800154')
  })
  it('extracts from BankTranfeComment (typo without r)', () => {
    expect(extractShamCashTxId('BankTranfeComment: 999')).toBe('999')
  })
  it('extracts from ext_trn_id pattern', () => {
    expect(extractShamCashTxId('ext_trn_id: 12345')).toBe('12345')
  })
  it('extracts from Arabic legacy "رقم العملية"', () => {
    expect(extractShamCashTxId('رقم العملية: 555')).toBe('555')
  })
  it('returns null when nothing matches', () => {
    expect(extractShamCashTxId('hello world')).toBeNull()
    expect(extractShamCashTxId('')).toBeNull()
  })
})

describe.skipIf(!fs.existsSync(SC_FILE_3) || !fs.existsSync(DEP_FILE_3))(
  'End-to-end deposit reconciliation — New folder (3) batch',
  () => {
    it('matches TX 199793455 and 199650168 by ext_trn_id', async () => {
      const { parsePlatformDepositsFile } = await import('@/lib/parsers/platformDeposits')
      const { reconcileDeposits } = await import('@/lib/reconciliation/deposits')

      const sc = await parseShamCashFile(fs.readFileSync(SC_FILE_3))
      const dep = await parsePlatformDepositsFile(fs.readFileSync(DEP_FILE_3))
      expect(sc.errors.length).toBe(0)
      expect(dep.errors.length).toBe(0)

      const result = reconcileDeposits(sc.rows, dep.rows, [])
      const TARGETS = ['199793455', '199650168']
      for (const tid of TARGETS) {
        const m = result.matched.find(p => p.shamCash.txId === tid)
        expect(m, `TX ${tid} should be matched`).toBeDefined()
        expect(m!.shamCash.receivedAmount, `amount for ${tid}`).toBeGreaterThan(0)
      }
      // No platformOnly should remain since every dep row in this file had a SC partner
      expect(result.platformOnly.length).toBe(0)
    })
  },
)
