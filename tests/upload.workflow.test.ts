import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const m = vi.hoisted(() => ({ session: vi.fn(), create: vi.fn(), update: vi.fn(), process: vi.fn(), account: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: m.session }))
vi.mock('@/lib/db/client', () => ({ db: { auditLog: { create: m.create, update: m.update }, account: { findUnique: m.account }, user: { findFirst: m.admin } } }))
vi.mock('@/lib/reconciliation/batchProcessor', () => ({ processBatch: m.process }))
import { POST } from '@/app/api/upload/route'
import { ImportValidationError } from '@/lib/parsers/validation'
const id = 'ff7142c4-06b6-4527-bf03-d8418078fe56'
function request(file = true, machine = false) {
  const form = new FormData(); form.set('accountId', 'account')
  if (file) form.set('shamCash', new Blob(['invalid-file']), 'test.xlsx')
  return new NextRequest('http://localhost/api/upload', { method: 'POST', body: form,
    headers: { 'X-Upload-Attempt-Id': id, ...(machine ? { authorization: 'Bearer test-operator-token' } : {}) } })
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('OPS_TOKEN', 'test-operator-token'); vi.stubEnv('CRON_SECRET', '')
  m.session.mockResolvedValue({ userId: 'human', role: 'ADMIN' })
  m.account.mockResolvedValue({ id: 'account' }); m.admin.mockResolvedValue({ id: 'legacy-fk-owner' })
  m.process.mockResolvedValue({ batchId: 'batch', summary: {} })
})
describe('upload request provenance and failure history', () => {
  it('records start before processing, and preserves a parser failure without a batch', async () => {
    m.process.mockRejectedValue(new ImportValidationError(['شام كاش: bad header']))
    const response = await POST(request())
    expect(response.status).toBe(400)
    expect(m.create.mock.invocationCallOrder[0]).toBeLessThan(m.process.mock.invocationCallOrder[0])
    const final = m.update.mock.calls.at(-1)![0].data.details
    expect(final).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_FILE', actorType: 'HUMAN', actorUserId: 'human', authMethod: 'SESSION' })
  })
  it('retains rejected empty uploads, not just batches that reach persistence', async () => {
    expect((await POST(request(false))).status).toBe(400)
    expect(m.create).toHaveBeenCalledOnce(); expect(m.process).not.toHaveBeenCalled()
    expect(m.update.mock.calls.at(-1)![0].data.details.status).toBe('FAILED')
  })
  it('does not impersonate the legacy upload owner for a machine request', async () => {
    expect((await POST(request(true, true))).status).toBe(200)
    expect(m.create.mock.calls[0][0].data).toMatchObject({ userId: null,
      details: { actorType: 'SERVICE', authMethod: 'OPS_TOKEN', actorUserId: null } })
    expect(m.session).not.toHaveBeenCalled()
    expect(JSON.stringify(m.create.mock.calls)).not.toContain('test-operator-token')
  })
  it('refuses to process a repeated attempt ID', async () => {
    m.create.mockRejectedValue({ code: 'P2002' })
    expect((await POST(request())).status).toBe(409)
    expect(m.process).not.toHaveBeenCalled()
  })
  it('fails closed when attempt storage is unavailable', async () => {
    m.create.mockRejectedValue(new Error('secret connection string'))
    const response = await POST(request())
    expect(response.status).toBe(503); expect(m.process).not.toHaveBeenCalled()
    expect(JSON.stringify(await response.json())).not.toContain('secret')
  })
  it('does not relabel an already committed upload failed when its last progress write fails', async () => {
    m.update.mockImplementation(async ({ data }) => { if (data.details.stage === 'COMPLETED') throw new Error('unavailable') })
    expect((await POST(request())).status).toBe(200)
    expect(m.update.mock.calls.some(([args]) => args.data.details.status === 'FAILED')).toBe(false)
  })
})
