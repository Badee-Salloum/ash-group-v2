import { describe, expect, it } from 'vitest'
import { assertValidImports, ImportValidationError } from '@/lib/parsers/validation'

describe('financial import validation', () => {
  it('rejects a partially parsed file and exposes actionable row errors', () => {
    expect(() => assertValidImports([{ label: 'شام كاش', errors: ['صف 3: نوع العملية غير معروف'] }]))
      .toThrow(ImportValidationError)
  })
  it('allows fully valid and absent optional files', () => {
    expect(() => assertValidImports([{ label: 'شام كاش', errors: [] }, { label: 'الإيداعات', errors: [] }])).not.toThrow()
  })
})
