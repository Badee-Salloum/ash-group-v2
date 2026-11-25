import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ dbTransaction: vi.fn(), parser: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: { $transaction: mocks.dbTransaction } }))
vi.mock('@/lib/auth', () => ({ audit: vi.fn() }))
vi.mock('@/lib/parsers/shamCash', () => ({ parseShamCashFile: mocks.parser }))
import { processBatch } from '@/lib/reconciliation/batchProcessor'

describe('invalid financial uploads', () => {
  it('rejects partial parser results before creating a batch or modifying history', async () => {
    mocks.parser.mockResolvedValue({ rows: [{ txId: 'valid' }], errors: ['صف 3: نوع العملية غير معروف'] })
    await expect(processBatch('a', { shamCashBuffer: Buffer.from('fixture') }, 'u')).rejects.toThrow('لم تُحفظ الدفعة')
    expect(mocks.dbTransaction).not.toHaveBeenCalled()
  })
})
